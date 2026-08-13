// leading line comment with a ; semicolon
CREATE (a:N {name: 'has ; semicolon'});
/* block comment; with semicolon */
MATCH (n) WHERE n.s = "double ; quote" SET n.x = 1;
CREATE (b {q: 'escaped \' quote ; here'}) ;
;
   ;
MERGE (c {p: "esc \" dq ; x"})
