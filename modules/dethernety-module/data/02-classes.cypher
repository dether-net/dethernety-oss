LOAD CSV FROM '/var/lib/memgraph/import/dethernety/DTComponentClass.csv' WITH HEADER AS row
MERGE (c:DTComponentClass {id: row.id})
SET c.name = row.name,
    c.description = row.description,
    c.category = row.category,
    c.type = row.type,
    c.template = row.template,
    c.configurationOptionsGuide = row.configurationOptionsGuide,
    c.regoPolicies = row.regoPolicies
WITH c
MATCH (m:DTModule {name: 'dethernety'})
MERGE (m)-[:MODULE_PROVIDES_CLASS]->(c);

LOAD CSV FROM '/var/lib/memgraph/import/dethernety/DTControlClass.csv' WITH HEADER AS row
MERGE (c:DTControlClass {id: row.id})
SET c.name = row.name,
    c.description = row.description,
    c.category = row.category,
    c.type = row.type,
    c.template = row.template,
    c.configurationOptionsGuide = row.configurationOptionsGuide,
    c.regoPolicies = row.regoPolicies
WITH c
MATCH (m:DTModule {name: 'dethernety'})
MERGE (m)-[:MODULE_PROVIDES_CLASS]->(c);

LOAD CSV FROM '/var/lib/memgraph/import/dethernety/DTDataFlowClass.csv' WITH HEADER AS row
MERGE (c:DTDataFlowClass {id: row.id})
SET c.name = row.name,
    c.description = row.description,
    c.category = row.category,
    c.type = row.type,
    c.template = row.template,
    c.configurationOptionsGuide = row.configurationOptionsGuide,
    c.regoPolicies = row.regoPolicies
WITH c
MATCH (m:DTModule {name: 'dethernety'})
MERGE (m)-[:MODULE_PROVIDES_CLASS]->(c);

LOAD CSV FROM '/var/lib/memgraph/import/dethernety/DTSecurityBoundaryClass.csv' WITH HEADER AS row
MERGE (c:DTSecurityBoundaryClass {id: row.id})
SET c.name = row.name,
    c.description = row.description,
    c.category = row.category,
    c.type = row.type,
    c.template = row.template,
    c.configurationOptionsGuide = row.configurationOptionsGuide,
    c.regoPolicies = row.regoPolicies
WITH c
MATCH (m:DTModule {name: 'dethernety'})
MERGE (m)-[:MODULE_PROVIDES_CLASS]->(c);

LOAD CSV FROM '/var/lib/memgraph/import/dethernety/DTIssueClass.csv' WITH HEADER AS row
MERGE (c:DTIssueClass {id: row.id})
SET c.name = row.name,
    c.description = row.description,
    c.category = row.category,
    c.type = row.type,
    c.template = row.template,
    c.configurationOptionsGuide = row.configurationOptionsGuide,
    c.regoPolicies = row.regoPolicies
WITH c
MATCH (m:DTModule {name: 'dethernety'})
MERGE (m)-[:MODULE_PROVIDES_CLASS]->(c);

LOAD CSV FROM '/var/lib/memgraph/import/dethernety/DTDataClass.csv' WITH HEADER AS row
MERGE (c:DTDataClass {id: row.id})
SET c.name = row.name,
    c.description = row.description,
    c.category = row.category,
    c.type = row.type,
    c.template = row.template,
    c.configurationOptionsGuide = row.configurationOptionsGuide,
    c.regoPolicies = row.regoPolicies
WITH c
MATCH (m:DTModule {name: 'dethernety'})
MERGE (m)-[:MODULE_PROVIDES_CLASS]->(c);

