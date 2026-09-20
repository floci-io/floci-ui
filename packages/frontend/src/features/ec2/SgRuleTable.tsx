import { Trash2 } from "lucide-react";
import { newRule, ruleErrors } from "./sgRuleHelpers";

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
        <div style={{
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: "12px 16px",
          fontSize: 12,
          color: "var(--text-2)",
          marginBottom: 8,
        }}>
          No {direction.toLowerCase()} rules. Click Add rule to create one.
        </div>
      ) : (
        <div style={{
          border: "1px solid var(--border)",
          borderRadius: 4,
          marginBottom: 8,
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Protocol</th>
                <th style={thStyle}>Port range</th>
                <th style={thStyle}>{sourceLabel}</th>
                <th style={thStyle}>Description</th>
                <th style={{ ...thStyle, width: 32 }} />
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, idx) => {
                const errs = ruleErrors(rule);
                return (
                <tr key={rule.id} style={{
                  borderBottom: idx < rules.length - 1 ? "1px solid var(--border-faint)" : "none",
                }}>
                  {/* Type */}
                  <td style={tdStyle}>
                    {readonly ? (
                      <span style={{ fontSize: 12 }}>{presetFor(rule.type)?.label ?? rule.type}</span>
                    ) : (
                      <select
                        className="input"
                        style={{ width: 150, fontSize: 12 }}
                        value={rule.type}
                        onChange={(e) => handleTypeChange(rule.id, e.target.value)}
                      >
                        {RULE_PRESETS.map((p) => (
                          <option key={p.key} value={p.key}>{p.label}</option>
                        ))}
                      </select>
                    )}
                  </td>

                  {/* Protocol */}
                  <td style={{ ...tdStyle, color: "var(--text-2)" }}>
                    {rule.protocol === "-1" ? "All" : rule.protocol.toUpperCase()}
                  </td>

                  {/* Port range */}
                  <td style={tdStyle}>
                    {rule.protocol === "-1" || rule.protocol === "icmp" || readonly || !isCustomType(rule.type) ? (
                      <span style={{ color: "var(--text-2)", fontSize: 12 }}>{portRangeDisplay(rule)}</span>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <div>
                          <input
                            className="input"
                            style={{ width: 52, fontSize: 12, minWidth: "unset", borderColor: errs.fromPort ? "var(--status-error)" : undefined }}
                            placeholder="From"
                            value={rule.fromPort}
                            onChange={(e) => updateRule(rule.id, { fromPort: e.target.value })}
                            title={errs.fromPort}
                          />
                        </div>
                        <span style={{ color: "var(--text-2)" }}>–</span>
                        <div>
                          <input
                            className="input"
                            style={{ width: 52, fontSize: 12, minWidth: "unset", borderColor: errs.toPort ? "var(--status-error)" : undefined }}
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
                      <span style={{ fontSize: 12 }}>{rule.cidr}</span>
                    ) : (
                      <div>
                        <input
                          className="input"
                          style={{ width: 150, fontSize: 12, minWidth: "unset", borderColor: errs.cidr ? "var(--status-error)" : undefined }}
                          placeholder="0.0.0.0/0"
                          value={rule.cidr}
                          onChange={(e) => updateRule(rule.id, { cidr: e.target.value })}
                          title={errs.cidr}
                        />
                        {errs.cidr && (
                          <p style={{ fontSize: 11, color: "var(--status-error)", margin: "2px 0 0", whiteSpace: "nowrap" }}>{errs.cidr}</p>
                        )}
                      </div>
                    )}
                  </td>

                  {/* Description */}
                  <td style={tdStyle}>
                    {readonly ? (
                      <span style={{ fontSize: 12, color: "var(--text-2)" }}>{rule.description}</span>
                    ) : (
                      <input
                        className="input"
                        style={{ width: 150, fontSize: 12, minWidth: "unset" }}
                        placeholder="optional"
                        value={rule.description}
                        onChange={(e) => updateRule(rule.id, { description: e.target.value })}
                      />
                    )}
                  </td>

                  {/* Delete */}
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    {!readonly && (
                      <button className="icon-btn danger" type="button" onClick={() => removeRow(rule.id)}>
                        <Trash2 size={13} />
                      </button>
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
        <button className="button" type="button" onClick={addRow} style={{ fontSize: 12 }}>
          + Add rule
        </button>
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
