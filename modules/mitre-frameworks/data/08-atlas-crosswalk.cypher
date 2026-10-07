MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0000"})
MATCH (t:MitreAttackTechnique {attack_id: "T1596"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1596";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0000.001"})
MATCH (t:MitreAttackTechnique {attack_id: "T1596"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1596";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0000.002"})
MATCH (t:MitreAttackTechnique {attack_id: "T1596"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1596";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0000.003"})
MATCH (t:MitreAttackTechnique {attack_id: "T1596.005"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1596.005";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0003"})
MATCH (t:MitreAttackTechnique {attack_id: "T1594"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1594";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0006"})
MATCH (t:MitreAttackTechnique {attack_id: "T1595"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1595";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0006.002"})
MATCH (t:MitreAttackTechnique {attack_id: "T1595"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1595";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0006.003"})
MATCH (t:MitreAttackTechnique {attack_id: "T1595"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1595";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0008"})
MATCH (t:MitreAttackTechnique {attack_id: "T1583"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1583";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0008.002"})
MATCH (t:MitreAttackTechnique {attack_id: "T1583.001"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1583.001";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0008.004"})
MATCH (t:MitreAttackTechnique {attack_id: "T1583.007"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1583.007";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0011.003"})
MATCH (t:MitreAttackTechnique {attack_id: "T1204"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1204";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0012"})
MATCH (t:MitreAttackTechnique {attack_id: "T1078"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1078";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0016"})
MATCH (t:MitreAttackTechnique {attack_id: "T1588"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1588";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0016.001"})
MATCH (t:MitreAttackTechnique {attack_id: "T1588.002"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1588.002";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0016.003"})
MATCH (t:MitreAttackTechnique {attack_id: "T1588.005"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1588.005";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0017"})
MATCH (t:MitreAttackTechnique {attack_id: "T1587"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1587";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0021"})
MATCH (t:MitreAttackTechnique {attack_id: "T1585"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1585";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0036"})
MATCH (t:MitreAttackTechnique {attack_id: "T1213"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1213";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0037"})
MATCH (t:MitreAttackTechnique {attack_id: "T1005"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1005";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0049"})
MATCH (t:MitreAttackTechnique {attack_id: "T1190"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1190";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0050"})
MATCH (t:MitreAttackTechnique {attack_id: "T1059"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1059";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0052"})
MATCH (t:MitreAttackTechnique {attack_id: "T1566"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1566";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0055"})
MATCH (t:MitreAttackTechnique {attack_id: "T1552"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1552";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0073"})
MATCH (t:MitreAttackTechnique {attack_id: "T1684.001"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1656";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0074"})
MATCH (t:MitreAttackTechnique {attack_id: "T1036"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1036";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0078"})
MATCH (t:MitreAttackTechnique {attack_id: "T1189"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1189";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0087"})
MATCH (t:MitreAttackTechnique {attack_id: "T1589"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1589";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0090"})
MATCH (t:MitreAttackTechnique {attack_id: "T1003"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1003";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0091"})
MATCH (t:MitreAttackTechnique {attack_id: "T1550"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1550";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0091.000"})
MATCH (t:MitreAttackTechnique {attack_id: "T1550.001"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1550.001";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0091.001"})
MATCH (t:MitreAttackTechnique {attack_id: "T1550.004"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1550.004";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0095"})
MATCH (t:MitreAttackTechnique {attack_id: "T1593"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1593";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0095.000"})
MATCH (t:MitreAttackTechnique {attack_id: "T1593.003"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1593.003";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0097"})
MATCH (t:MitreAttackTechnique {attack_id: "T1497"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1497";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0105"})
MATCH (t:MitreAttackTechnique {attack_id: "T1611"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1611";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0106"})
MATCH (t:MitreAttackTechnique {attack_id: "T1211"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1211";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0107"})
MATCH (t:MitreAttackTechnique {attack_id: "T1211"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1211";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0113"})
MATCH (t:MitreAttackTechnique {attack_id: "T1539"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1539";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0122"})
MATCH (t:MitreAttackTechnique {attack_id: "T1210"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1210";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0125"})
MATCH (t:MitreAttackTechnique {attack_id: "T1136"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1136";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0126"})
MATCH (t:MitreAttackTechnique {attack_id: "T1119"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1119";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0127"})
MATCH (t:MitreAttackTechnique {attack_id: "T1074"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1074";

MATCH (s:MitreAtlasTechnique {atlas_id: "AML.T0128"})
MATCH (t:MitreAttackTechnique {attack_id: "T1584"})
MERGE (s)-[r:ATLAS_TECHNIQUE_REFERENCES]->(t)
SET r.cited_attack_id = "T1584";

