---
type: Skill
name: dbt-template
title: dbt Template
description: Simple dbt workflow patterns for data transformation, testing, and project management. Use when creating dbt projects, running data pipelines, or implementing analytics engineering workflows.
tags: [data, dbt, analytics, transformation, data-engineering]
timestamp: 2026-08-04T00:00:00Z
id: skill-dbt-template
cdr_ref: null
created: 2026-01-16
modified: 2026-06-14
verified: 2026-08-04
age_days: 0
evidence: []
instruction_type: Generation
priority: Standard
---

# dbt Template

## What This Skill Provides

Simple dbt workflow patterns for data engineering projects with focus on:
- Basic dbt project setup and structure
- Simple dbt CLI commands (run, test, build)
- Integration with team constitution principles
- Reference patterns for analytics engineering

## When to Use This Skill

- Creating new dbt projects
- Setting up data transformation workflows
- Implementing analytics engineering patterns
- Managing dbt project lifecycle

## Quick Setup Guide

### Prerequisites
- dbt Core installed (pip install dbt-core)
- Data warehouse connection configured
- Basic SQL knowledge

### Initialize dbt Project
```bash
# Create new dbt project
dbt init my-analytics-project
cd my-analytics-project

# Configure connection in profiles.yml
# See references for team constitution guidelines
```

## Core Patterns

### Basic dbt Workflow

**Rule**: Use standard dbt workflow for data transformation

**Implementation**:
```bash
# Run models (data transformation)
dbt run

# Test models (data quality)
dbt test

# Build documentation
dbt docs generate
```

### Project Structure

**Rule**: Follow standard dbt project structure

**Implementation**:
```
my-analytics-project/
├── models/          # SQL models for data transformation
├── tests/           # Data quality tests
├── snapshots/       # Snapshot configurations
├── macros/          # Reusable SQL macros
├── dbt_project.yml # Project configuration
└── profiles.yml     # Connection configurations
```

## Integration with Team Constitution

### Principle 2 (Build for Observability)
- Add logging to dbt models for debugging
- Include data quality metrics in tests
- Document model dependencies

### Principle 4 (Tests Drive Confidence)
- Write tests for all critical models
- Include data freshness checks
- Test edge cases and data boundaries

### Principle 9 (Simplicity First)
- Keep models focused and single-purpose
- Avoid complex nested transformations
- Use clear naming conventions

### Principle 11 (Goal-Driven Execution)
- Define success criteria for data pipelines
- Measure data quality and performance
- Document business value of transformations

## References

- **Team Constitution**: See references/constitution.md (Principles 2, 4, 9, 11)
- **Testing Guidelines**: See references/testing_guide.md for data quality patterns

## Usage Examples

### Simple Data Transformation
```sql
-- models/stg_customers.sql
SELECT 
    id,
    name,
    email,
    created_at
FROM source.raw_customers
WHERE created_at >= '2023-01-01'
```

### Basic Data Test
```sql
-- tests/stg_customers_unique_email.sql
SELECT email FROM stg_customers
GROUP BY email
HAVING count(*) > 1
```

## Best Practices

- Keep models simple and focused
- Use descriptive naming conventions
- Add documentation for complex transformations
- Test critical data quality assumptions
- Follow team security guidelines for data access