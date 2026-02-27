# mitre-frameworks: MITRE Framework Data Ingestion Tool

This Python-based tool ingests data from the MITRE ATT&CK and MITRE D3FEND frameworks into the Neo4j database used by the Dethernety threat modeling framework. It ensures that the latest threat and defense techniques are available for security analysis.

## Features

- **MITRE ATT&CK Ingestion**: Imports techniques, tactics, and mitigations from the ATT&CK framework
- **MITRE D3FEND Ingestion**: Imports defensive techniques from the D3FEND framework
- **Relationship Mapping**: Creates relationships between attack patterns and defenses
- **Versioning Support**: Handles multiple versions of the MITRE frameworks
- **Database Integration**: Directly populates the Neo4j graph database

## Supported MITRE Data

The tool ingests the following MITRE data:

### MITRE ATT&CK
- Tactics (categories of adversary objectives)
- Techniques (specific adversary behaviors)
- Sub-techniques (more specific behaviors under techniques)
- Mitigations (countermeasures for techniques)

### MITRE D3FEND
- Defensive techniques
- Defensive tactics
- Relationships to ATT&CK techniques

## Usage

```bash
# Set up Python virtual environment
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Clean existing MITRE data from database
pnpm m-cleanup

# Ingest MITRE data into database
pnpm m-ingest

# Run tests
pnpm test

# Test parsing functionality
pnpm parsetest
```

## Configuration

Configuration is managed through environment variables (typically set in a `.env` file at the project root):

- `NEO4J_URI`: URI for the Neo4j database
- `NEO4J_USERNAME`: Username for Neo4j authentication
- `NEO4J_PASSWORD`: Password for Neo4j authentication
- `MITRE_ATTACK_VERSION`: Version of MITRE ATT&CK to ingest (default: latest)
- `MITRE_DEFEND_VERSION`: Version of MITRE D3FEND to ingest (default: latest)

## Data Model

The tool creates the following Neo4j node types:

- `MitreAttackTactic`: Represents ATT&CK tactics
- `MitreAttackTechnique`: Represents ATT&CK techniques and sub-techniques
- `MitreAttackMitigation`: Represents ATT&CK mitigations
- `MitreDefendTactic`: Represents D3FEND tactics
- `MitreDefendTechnique`: Represents D3FEND techniques

And the following relationships:

- `TACTIC_INCLUDES_TECHNIQUE`: Links tactics to techniques
- `SUBTECHNIQUE_OF`: Links sub-techniques to parent techniques
- `MITIGATION_DEFENDS_AGAINST_TECHNIQUE`: Links mitigations to techniques
- `ENABLES`: Links D3FEND techniques to tactics
- `SUB_TECHNIQUE_OF`: Links D3FEND sub-techniques to parent techniques

## Integration with Dethernety

The ingested MITRE data is used by the Dethernety framework to:

1. Map detected exposures to relevant ATT&CK techniques
2. Recommend appropriate defenses based on D3FEND techniques
3. Provide a comprehensive view of threats and mitigations
4. Support AI-powered security analysis

## Development

To extend the ingestion tool:

1. Update the data models in `models.py`
2. Modify the ingestion logic in `ingest.py`
3. Add tests for new functionality
4. Ensure compatibility with the Neo4j schema 