# Changelog

All notable changes to the LevelUp extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.8.0] - 2026-06-13

### Added

- **Descriptor column in CDR.md index**: `/levelup.implement` now emits a `Descriptor` column
  in the published CDR.md index table, providing a "when to use" summary for each context module.
  The per-CDR block includes a new `### Descriptor` field derived from the CDR's `### Context`
  and `### Decision` sections.

## [1.7.1] - 2026-06-08

### Changed

- **Trace command ownership**: moved feature trace generation from `/levelup.trace` to `/spec.trace`
  - Trace remains stored at `specs/{BRANCH}/trace.md`
  - LevelUp continues consuming `trace.md` through `/levelup.specify`
  - Updated LevelUp documentation and validation guidance to reference `/spec.trace`

## [1.7.0] - 2026-05-30

### Changed

- **BREAKING: Constitution CDR Lifecycle** - Constitution changes now follow the CDR workflow instead of direct file writes:
  - `/levelup.init` Phase 8 now creates Constitution CDRs in `.specify/drafts/cdr.md` instead of writing to team-ai-directives
  - Constitution changes require review via `/levelup.clarify` and acceptance before publication
  - `/levelup.implement` handles both Constitution Creation and Amendment CDRs
  - Ensures team review and validation of all constitution changes
  - Provides audit trail through CDR tracking

### Added

- **Constitution CDR Types**: Added support for `Constitution Creation` and `Constitution Amendment` CDR types
- **Constitution Strategy Section**: New section in CDR template for tracking constitution derivation, version strategy, and ratification plan
- **State Tracking**: Added `constitution_cdr_generation` to state.json for tracking constitution CDR creation

### Fixed

- Constitution generation now properly integrates with the CDR lifecycle
- Teams must review and accept constitution changes before publication
- Prevents accidental constitution changes during brownfield analysis

## [1.6.4] - 2026-05-29

### Added

- **Constitution Generation Phase (Phase 8)**: New phase in `/levelup.init` that generates or enhances team constitution from discovered patterns
  - Derives principles from cross-cutting patterns (patterns in ≥50% of sub-systems)
  - Creates principles from inconsistency resolutions
  - Preserves existing constitution when enhancing
  - ~~Writes to `{TEAM_DIRECTIVES}/context_modules/constitution.md`~~ **Changed in v1.7.0**: Now creates CDRs instead
- **`--skip-constitution` flag**: Skip constitution generation phase

### Changed

- `init.md`: Added Phase 8 (Constitution Generation), renumbered Phase 8→9, Phase 9→10
- `init.md`: Fixed Pattern Agent input to include `constitution` in `team_directives` object
- `extension.yml`: Version bump to 1.6.4

## [1.6.3] - 2026-05-29

### Changed

- **Repair command moved**: `/levelup.repair` moved to team-ai-directives extension as `/team.repair`
  - Better alignment with team-admin workflow (paired with `team.verify`)
  - `agents-template.md` moved to `extensions/team-ai-directives/templates/`
  - `implement.md` updated to cross-reference template from team-ai-directives
- `extension.yml`: Version bump to 1.6.3

### Removed

- **analyze-context.sh**: Orphan script not referenced by any command
- **analyze-context.ps1**: Orphan PowerShell script not referenced by any command

## [1.6.1] - 2026-05-23

### Fixed

- **repair.md**: Redundant ID generation fixed - strips context type directory prefix (`rules/`, `personas/`, `examples/`) before generating IDs (e.g., `rules/style-guides/java/google_style_guide.md` now produces `rule-style-guides-java-google_style_guide` instead of `rule-rules-style-guides-java-google_style_guide`)
- **repair.md**: CDR references preserved during repair - orphan files now look up existing CDR.md entries before setting `cdr_ref: null`, preventing CDR reference loss
- **repair.md**: AGENTS.md section check now uses flexible grep (`grep -qiE "##.*CDR\\.md"`) to match both `## CDR.md` and `## Context Directive Records (CDR.md)`
- **validate-directives.sh**: Fixed jq error `Could not open file []` caused by passing JSON string `"[]"` as a filename argument to `jq -s` in line 439; now pipes both inputs via stdin

### Changed

- `extension.yml`: Version bump to 1.6.1

## [1.6.0] - 2026-05-22

### Added

- **Repair Command**: New `/levelup.repair` command for re-indexing team-ai-directives files
  - Rebuilds CDR.md from context_modules/ directory
  - Rebuilds .skills.json from skills/ directory
  - Validates and repairs AGENTS.md (creates if missing, restores if corrupted)
  - Auto-detects orphan context modules (missing YAML frontmatter)
  - Auto-detects orphan skills (missing .skills.json entries)
  - Auto-generates missing metadata from file content

- **Repair Flags**:
  - `--dry-run`: Report only, don't write changes
  - `--cdr-only`: Only repair CDR.md
  - `--skills-only`: Only repair .skills.json
  - `--agents-only`: Only repair AGENTS.md
  - Default: Repair all indexes with auto-fix

- **Auto-Fix Capabilities**:
  - Adds YAML frontmatter to orphan context modules
  - Generates .skills.json entries from SKILL.md content
  - Removes entries for missing files
  - Restores AGENTS.md from template if corrupted

### Changed

- `extension.yml`: Version bump to 1.6.0, registered `levelup.repair` command
- `README.md`: Added repair command to table, flow diagram, and usage documentation

## [1.5.0] - 2026-05-21

### Added

- **LLM-Based Functional Categorization**: Replaced technology-based paths with functional categories
  - 6 functional categories: style-guides, framework, security, testing, devops, data
  - LLM semantic analysis for automatic categorization
  - Confidence scoring with user fallback for ambiguous patterns
  - No static keyword mapping required

- **AGENTS.md Auto-Creation**: Creates AGENTS.md in team-ai-directives if missing
  - Minimal template documenting functional category structure
  - Non-destructive: never overwrites existing AGENTS.md
  - Added to git staging during implement phase

- **agents-template.md**: New template for AGENTS.md generation
  - Documents 6 functional categories
  - Explains loading order and rule structure
  - Provides usage guidance for skills and rules

### Changed

- **CDR.md Location**: Moved from `context_modules/CDR.md` to ROOT `CDR.md`
  - Aligns with Tikal template repository structure
  - Updated all references in implement.md
  - Git add command now includes ROOT CDR.md and AGENTS.md

- **Path Structure**: Technology-based → Functional category paths
  - Before: `rules/python/pydantic-patterns.md`
  - After: `rules/style-guides/python_pydantic_patterns.md`
  - Filename format: `{technology}_{pattern_name}.md` (underscores)

- **synthesis-prompt.md**: Added Step 3 for LLM categorization
  - Category decision framework
  - Confidence assessment logic
  - User prompt for uncertain categorizations

- **cdr-template.md**: Updated target module examples
  - Shows functional category paths
  - Documents new filename conventions

- **README.md**: Added Target Module Structure section
  - Documents all 6 functional categories
  - Shows example paths for each category

### Technical Details

- **New Files**: `templates/agents-template.md`
- **Modified Files**: 
  - `templates/subagents/synthesis-prompt.md` (LLM categorization)
  - `templates/cdr-template.md` (path examples)
  - `commands/implement.md` (CDR.md location, AGENTS.md creation)
  - `README.md` (documentation)
- **Deleted Files**: None (layout-mapping.yaml not created - using LLM instead)
- **Breaking Changes**: None for new CDRs (legacy CDRs keep original paths)
- **Minimum speckit_version**: >=0.0.80 (unchanged)

## [1.4.0] - 2026-05-18

### Added

- **Multi-Agent Sub-System Analysis**: Complete refactor of `/levelup.init` with three-phase pipeline
  - **Discovery Agent** (Phase 5): Scans each sub-system for raw patterns with evidence
  - **Pattern Agent** (Phase 6): Classifies patterns, scores reusability (0.0-1.0), checks team-directives
  - **Synthesis Agent** (Phase 7): Cross-sub-system analysis generating final CDRs
  
- **Cross-Sub-System Pattern Detection**:
  - Detects patterns appearing in ≥50% of sub-systems (cross-cutting)
  - Calculates cross-system score per pattern
  - Flags high-priority cross-cutting concerns
  
- **Inconsistency Detection**:
  - Automatic detection of same concern with different implementations
  - Creates special "Inconsistency" CDRs requiring team decision
  - Tracks resolution status and implementation plan
  
- **State Management & Resumability**:
  - State persisted to `.specify/levelup/state.json`
  - Resume interrupted scans with `--resume` flag
  - Per-sub-system checkpoint tracking
  
- **Team-Directives Comparison**:
  - Pattern Agent checks for existing similar patterns
  - Similarity scoring (0.0-1.0)
  - Gap identification for missing patterns
  
- **Cross-Sub-System Validation in Implement**:
  - Phase 1.8: Detects duplicate targets, rule conflicts, unresolved inconsistencies
  - Blocks implementation until conflicts resolved
  - Recommends `/levelup.clarify` for resolution

### Changed

- `/levelup.init`: Complete rewrite with multi-agent architecture
  - Sequential execution per sub-system
  - State-based resumability
  - Cross-system metadata in all CDRs
  
- `/levelup.implement`: Added Phase 1.8 for cross-sub-system conflict detection

- `cdr-template.md`: Added cross-system metadata and inconsistency resolution sections

- `extension.yml`: 
  - Version bump to 1.4.0
  - Added state, subagents, cross_system configuration
  - New tags: subagents, cross-system-analysis, inconsistency-detection

### Technical Details

- **New Files**: 3 sub-agent prompt templates (discovery-prompt.md, pattern-prompt.md, synthesis-prompt.md)
- **Modified Files**: init.md, implement.md, cdr-template.md, extension.yml
- **Breaking Changes**: None (backward compatible)
- **Minimum speckit_version**: >=0.0.80 (unchanged)

## [1.3.0] - 2026-05-18

### Added

- **Agent Memory Engineering**: Applied principles from production agent memory systems (Claude Code, Codex CLI, Hermes)
  - Signal Gate: Filters CDRs before publishing (strict mode - skips without evidence)
  - Verification Metadata: YAML frontmatter with `created`, `verified`, `age_days`
  - Freshness Tracking: Warnings for directives >30 days old
  - Verification Workflow: `/levelup.validate` updates timestamps for valid directives
  
- **New Templates with Memory Metadata**:
  - `rule-team-template.md`: Rule with YAML frontmatter and verification banner
  - `persona-team-template.md`: Persona with memory metadata
  - `example-team-template.md`: Example with freshness warnings
  - `skill-team-template.md`: Skill with verification log

- **Configuration Options**:
  - `memory_engineering.signal_gate`: Configure strict mode and criteria
  - `memory_engineering.verification`: Set age threshold (default: 30 days)
  - `memory_engineering.metadata`: Control frontmatter and banner inclusion

### Changed

- `/levelup.implement`:
  - Added Signal Gate phase (Phase 1.5) that filters CDRs without concrete evidence
  - Generates YAML frontmatter with `id`, `cdr_ref`, `created`, `modified`, `verified`, `age_days`
  - Adds freshness warning banner to published directives
  - Creates verification log table in directive files
  - Updated CDR.md index format with Created, Verified, Age columns

- `/levelup.validate`:
  - Added Phase 6: Verification Update (updates `verified` timestamps)
  - Resets `age_days` to 0 for valid directives
  - Reports stale directives (>30 days without verification)
  - Creates verification log entries

- `extension.yml`:
  - Version bump to 1.3.0
  - Added tags: `memory-engineering`, `signal-gate`, `verification`
  - Updated command descriptions
  - Added memory engineering defaults

- `config-template.yml`:
  - Added `[memory_engineering]` section with signal gate and verification settings

- `README.md`:
  - Added "Memory Engineering (v1.3.0)" section explaining signal gate and verification

## [1.2.0] - 2026-05-18

### Added

- **Skill Command Improvements** (6 patterns from best practices):
  - Pattern 1: Enhanced description with trigger keywords for better AI agent routing
  - Pattern 2: Converted all instructions to imperative verbs for clarity
  - Pattern 3: Added explicit output format specification in summary phase
  - Pattern 4: Added "Read Existing Skills" phase to match project patterns
  - Pattern 5: Added "Out of Scope" section for clear boundaries
  - Pattern 6: Merged SKILL.md templates and condensed content to <500 lines

### Changed

- `skills.md`: Complete rewrite following best practices from "Anatomy of a Perfect Skill"
- Reduced from 529 to 422 lines while adding 3 new sections
- Examples now in table format (3 examples instead of 4)
- Validation checklist condensed from 7 to 5 items

### Fixed

- Missing CHANGELOG entry for v1.1.9 (now documented)

## [1.1.9] - 2026-05-15

### Fixed

- **Path consistency**: Fixed template paths to use `{REPO_ROOT}` placeholder consistently

## [1.1.8] - 2026-04-30

### Fixed

- **Fragile path sourcing**: Fixed bash and PowerShell scripts using fragile relative paths to source common.sh. Now uses robust project-root-finding pattern that works regardless of script location.

## [1.1.7] - 2026-04-19

### Fixed

- **Auto-handoff to clarify**: Changed `send: false` to `send: true` in init.md (clarify handoff) and validate.md for automatic validation of discovered CDRs

### Changed

- `/adlc.levelup.init` now auto-triggers `/adlc.levelup.clarify` to validate discovered patterns
- `/adlc.levelup.validate` now auto-triggers `/adlc.levelup.clarify` to resolve conflicts

## [1.1.6] - 2026-04-13

### Fixed

- **Script path resolution**: Fixed session execution failures by using fully-qualified paths in command files
  - Changed from relative `scripts/bash/setup-levelup.sh` to `.specify/extensions/levelup/scripts/bash/setup-levelup.sh`

## [1.1.5] - 2026-04-11

### Fixed

- **Template path resolution**: Updated command templates to use `{REPO_ROOT}` prefix for `.specify/` paths
- **Team directives placeholder**: Changed relative `context_modules/` paths to use `{TEAM_DIRECTIVES}` prefix
- **Monorepo support**: Templates now correctly resolve paths when running from subdirectories

## [1.1.1] - 2026-04-11

### Fixed

- **.specify directory detection**: All scripts now use `get_repo_root()` from common.sh to properly locate `.specify` directory when running from subdirectories

## [1.1.0] - 2026-04-04

### Added

- **Skill Types Taxonomy** (Issue #84): Added 9-category skill type taxonomy from Anthropic's "Lessons from Building Claude Code: How We Use Skills"
  - `cdr-template.md`: Added Skill Type field with taxonomy table
  - `extension.yml`: Added `type` field to CDR defaults
  - `README.md`: Added Skill Types Taxonomy section with descriptions
  - `init.md`: Added Skill Type Classification phase during CDR discovery

- **Rule Conflict Detection** (Issue #68): Added rule conflict detection capabilities
  - `validate.md`: New command for scanning team-ai-directives for conflicts
  - `validate-directives.sh`: Main validation script with JSON/Markdown output
  - `validate-rule-conflicts.sh`: Helper script for detecting conflict types
  - `conflict-cdr-template.md`: Template for conflict resolution CDRs
  - `conflict-report-template.md`: Template for conflict reports
  - `clarify.md`: Added conflict detection phase (Questions 11-13) for rule CDRs
  - `extension.yml`: Registered `levelup.validate` command with handoffs

### Changed

- `clarify.md`: Updated status determination logic to account for conflict detection
- `README.md`: Added `/levelup.validate` to commands table and updated flow diagram
- Updated version to 1.1.0

## [1.0.0] - 2026-03-03

### Added

- Initial release of LevelUp extension
- `levelup.init` command for brownfield CDR discovery
- `levelup.clarify` command for resolving CDR ambiguities
- `levelup.specify` command for refining CDRs from feature context
- `levelup.skills` command for building skills from accepted CDRs
- `levelup.implement` command for creating PRs to team-ai-directives
- Context Directive Record (CDR) template
- Support for both submodule and clone paths for team-ai-directives
- Bash and PowerShell scripts for setup and analysis

### Related

- GitHub Issue: [#56](https://github.com/tikalk/agentic-sdlc-spec-kit/issues/56)
- Replaces monolithic `/spec.levelup` command
