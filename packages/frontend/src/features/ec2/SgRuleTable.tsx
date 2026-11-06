import {Icon, Trash2} from '@/components/sodium/icon'
import {Button} from '@/components/sodium/ui/button'
import {Input} from '@/components/sodium/ui/input'
import {OptionSelect} from '@/components/OptionSelect'
import { newRule, ruleErrors } from "./sgRuleHelpers";
import {Hint} from '@/components/Hint'

// ─── Types ────────────────────────────────────────────────────────────────────

export type SgRule = {
  id: string;
  type: string;
  protocol: string;
  fromPort: string;
  toPort: string;
  cidr: string;
  description: string;
};

// ─── Presets ──────────────────────────────────────────────────────────────────

type RulePreset = {
  key: string;
  label: string;
  protocol: string;
  fromPort: string;
  toPort: string;
};

const RULE_PRESETS: RulePreset[] = [
  { key: "ssh",        label: "SSH",             protocol: "tcp",  fromPort: "22",    toPort: "22"    },
  { key: "http",       label: "HTTP",            protocol: "tcp",  fromPort: "80",    toPort: "80"    },
  { key: "https",      label: "HTTPS",           protocol: "tcp",  fromPort: "443",   toPort: "443"   },
  { key: "rdp",        label: "RDP",             protocol: "tcp",  fromPort: "3389",  toPort: "3389"  },
  { key: "mysql",      label: "MySQL/Aurora",    protocol: "tcp",  fromPort: "3306",  toPort: "3306"  },
  { key: "postgres",   label: "PostgreSQL",      protocol: "tcp",  fromPort: "5432",  toPort: "5432"  },
  { key: "redis",      label: "Redis",           protocol: "tcp",  fromPort: "6379",  toPort: "6379"  },
  { key: "all-tcp",    label: "All TCP",         protocol: "tcp",  fromPort: "0",     toPort: "65535" },
  { key: "all-udp",    label: "All UDP",         protocol: "udp",  fromPort: "0",     toPort: "65535" },
  { key: "all-icmp",   label: "All ICMP",        protocol: "icmp", fromPort: "-1",    toPort: "-1"    },
  { key: "all",        label: "All traffic",     protocol: "-1",   fromPort: "0",     toPort: "0"     },
  { key: "custom-tcp", label: "Custom TCP",      protocol: "tcp",  fromPort: "",      toPort: ""      },
  { key: "custom-udp", label: "Custom UDP",      protocol: "udp",  fromPort: "",      toPort: ""      },
];

function presetFor(key: string): RulePreset | undefined {
  return RULE_PRESETS.find((p) => p.key === key);
}

function portRangeDisplay(rule: SgRule): string {
  if (rule.protocol === "-1") return "All";
  if (rule.protocol === "icmp") return "All ICMP";
  if (rule.fromPort === rule.toPort) return rule.fromPort;
  return `${rule.fromPort} – ${rule.toPort}`;
}

function isCustomType(typeKey: string): boolean {
  return typeKey === "custom-tcp" || typeKey === "custom-udp";
}

// ─── Component ────────────────────────────────────────────────────────────────

interface SgRuleTableProps {
  rules: SgRule[];
  onChange: (rules: SgRule[]) => void;
  direction: "Inbound" | "Outbound";
  /** Pass any truthy string to disable add/remove controls (read-only display) */
  addLabel?: string;
}

export function SgRuleTable({ rules, onChange, direction, addLabel }: SgRuleTableProps) {
  const readonly = Boolean(addLabel);

  function addRow() {
    onChange([...rules, newRule()]);
  }

  function removeRow(id: string) {
    onChange(rules.filter((r) => r.id !== id));
  }

  function updateRule(id: string, patch: Partial<SgRule>) {
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function handleTypeChange(id: string, typeKey: string) {
    const preset = presetFor(typeKey);
    if (!preset) return;
    updateRule(id, {
      type: typeKey,
      protocol: preset.protocol,
      fromPort: preset.fromPort,
      toPort: preset.toPort,
    });
  }

  const sourceLabel = direction === "Inbound" ? "Source" : "Destination";

  return (
    <div>
      {rules.length === 0 ? (
        <div className="py-3 px-4 type-caption text-text-2 mb-2 border border-line">
          No {direction.toLowerCase()} rules. Click Add rule to create one.
        </div>
      ) : (
        <div className="mb-2 border border-line">
          <table className="w-full border-collapse type-caption">
            <thead>
              <tr className="border-b border-line">
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Protocol</th>
                <th style={thStyle}>Port range</th>
                <th style={thStyle}>{sourceLabel}</th>
                <th style={thStyle}>Description</th>
                <th className="w-8" style={{...thStyle}} />
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, idx) => {
                const errs = ruleErrors(rule);
                return (
                <tr key={rule.id} className={idx < rules.length - 1 ? 'border-b border-line-faint' : undefined}>
                  {/* Type */}
                  <td style={tdStyle}>
                    {readonly ? (
                      <span className="type-caption">{presetFor(rule.type)?.label ?? rule.type}</span>
                    ) : (
                      <OptionSelect aria-label="Rule type" className="w-37.5"
                        value={rule.type}
                        onValueChange={(value) => handleTypeChange(rule.id, value)}
                      >
                        {RULE_PRESETS.map((p) => (
                          <option key={p.key} value={p.key}>{p.label}</option>
                        ))}
                      </OptionSelect>
                    )}
                  </td>

                  {/* Protocol */}
                  <td className="text-text-2" style={{...tdStyle}}>
                    {rule.protocol === "-1" ? "All" : rule.protocol.toUpperCase()}
                  </td>

                  {/* Port range */}
                  <td style={tdStyle}>
                    {rule.protocol === "-1" || rule.protocol === "icmp" || readonly || !isCustomType(rule.type) ? (
                      <span className="text-text-2 type-caption">{portRangeDisplay(rule)}</span>
                    ) : (
                      <div className="flex items-center gap-1">
                        <div>
                          <Input aria-label="From"
                            className="w-13 min-w-0"
                            aria-invalid={(errs.fromPort) ? true : undefined}
                            placeholder="From"
                            value={rule.fromPort}
                            onChange={(e) => updateRule(rule.id, { fromPort: e.target.value })}
                            title={errs.fromPort}
                          />
                        </div>
                        <span className="text-text-2">–</span>
                        <div>
                          <Input aria-label="To"
                            className="w-13 min-w-0"
                            aria-invalid={(errs.toPort) ? true : undefined}
                            placeholder="To"
                            value={rule.toPort}
                            onChange={(e) => updateRule(rule.id, { toPort: e.target.value })}
                            title={errs.toPort}
                          />
                        </div>
                      </div>
                    )}
                  </td>

                  {/* CIDR */}
                  <td style={tdStyle}>
                    {readonly ? (
                      <span >{rule.cidr}</span>
                    ) : (
                      <div>
                        <Input aria-label="0.0.0.0/0"
                          className="w-37.5 min-w-0"
                          aria-invalid={(errs.cidr) ? true : undefined}
                          placeholder="0.0.0.0/0"
                          value={rule.cidr}
                          onChange={(e) => updateRule(rule.id, { cidr: e.target.value })}
                          title={errs.cidr}
                        />
                        {errs.cidr && (
                          <p className="text-fail-text mt-0.5 mx-0 mb-0 whitespace-nowrap">{errs.cidr}</p>
                        )}
                      </div>
                    )}
                  </td>

                  {/* Description */}
                  <td style={tdStyle}>
                    {readonly ? (
                      <span className="type-caption text-text-2">{rule.description}</span>
                    ) : (
                      <Input aria-label="Rule description"
                        className="w-37.5 min-w-0"
                        placeholder="optional"
                        value={rule.description}
                        onChange={(e) => updateRule(rule.id, { description: e.target.value })}
                      />
                    )}
                  </td>

                  {/* Delete */}
                  <td className="text-center" style={{...tdStyle}}>
                    {!readonly && (
                      <Hint label="Remove rule"><Button variant="ghost" size="icon-sm" type="button" aria-label="Remove rule" onClick={() => removeRow(rule.id)}>
                        <Icon icon={Trash2} size={14} />
                      </Button></Hint>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!readonly && (
        <Button variant="secondary" type="button" onClick={addRow}>
          + Add rule
        </Button>
      )}
    </div>
  );
}

// ─── Cell styles ──────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: "8px 10px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-2)",
  background: "var(--surface-2)",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "6px 10px",
  verticalAlign: "middle",
};
