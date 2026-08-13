// Package cypher splits a Cypher script into individual statements the way the module
// installer does, so a file of data-load statements can be executed one at a time over
// a Bolt session.
//
// It is a port of the reference splitter in oss/scripts/module-manager/database.ts
// (parseStatements): the two must agree on the split of any well-formed corpus, because
// the same committed .cypher files are split by whichever installer runs. The splitter is
// intentionally small — it is not a Cypher parser, only enough lexing to know when a
// semicolon ends a statement rather than sitting inside a string or a comment.
//
// Two limitations are shared with the reference and deliberate:
//   - Backtick-quoted identifiers (`like this`) are NOT lexed as strings — a ';' or a
//     quote inside one is treated as ordinary text. Statement-level backtick identifiers
//     are not used by the ingested corpus; if one is ever introduced, both this port and
//     the reference must gain backtick handling together (backtick escapes by doubling,
//     not with a backslash), or the split will diverge.
//
// One behaviour is an intentional, safe strengthening over the reference: an unterminated
// string literal or block comment at end of input is a hard error rather than a silent
// truncation. It cannot occur in a well-formed corpus, so it never changes a valid split;
// it exists so an authoring accident baked into a signed artifact fails loudly at this
// deploy-time trust boundary instead of ingesting a silent subset.
package cypher

import (
	"errors"
	"strings"
)

// ParseStatements splits content on semicolons, ignoring semicolons inside string
// literals and comments. Line comments (//) and block comments (/* */) are dropped;
// escape sequences (\", \', \\) carry the escaped character through verbatim. Empty
// statements (only whitespace between two semicolons) are omitted, and a trailing
// statement without a closing semicolon is kept.
//
// It returns an error if the input ends inside an unterminated string literal or block
// comment — a malformed corpus that would otherwise ingest a silent subset.
func ParseStatements(content string) ([]string, error) {
	var statements []string
	var current strings.Builder

	inString := false
	var stringChar byte
	inLineComment := false
	inBlockComment := false

	flush := func() {
		if s := strings.TrimSpace(current.String()); s != "" {
			statements = append(statements, s)
		}
		current.Reset()
	}

	for i := 0; i < len(content); {
		ch := content[i]
		var next byte
		if i+1 < len(content) {
			next = content[i+1]
		}

		// Block comment start.
		if !inString && !inLineComment && !inBlockComment && ch == '/' && next == '*' {
			inBlockComment = true
			i += 2
			continue
		}
		// Block comment end.
		if inBlockComment && ch == '*' && next == '/' {
			inBlockComment = false
			i += 2
			continue
		}
		if inBlockComment {
			i++
			continue
		}

		// Line comment start.
		if !inString && !inLineComment && ch == '/' && next == '/' {
			inLineComment = true
			i += 2
			continue
		}
		// Line comment end. The newline is preserved into the statement so line
		// boundaries inside a statement survive a comment on their own line.
		if inLineComment && ch == '\n' {
			inLineComment = false
			current.WriteByte('\n')
			i++
			continue
		}
		if inLineComment {
			i++
			continue
		}

		// Escape sequences (\", \', \\) — carry both bytes through. Checked BEFORE the
		// quote toggles below so a \" inside a string does not end it, matching the
		// reference.
		if ch == '\\' && i+1 < len(content) {
			current.WriteByte(ch)
			current.WriteByte(content[i+1])
			i += 2
			continue
		}

		// String literal start.
		if !inString && (ch == '\'' || ch == '"') {
			inString = true
			stringChar = ch
			current.WriteByte(ch)
			i++
			continue
		}
		// String literal end.
		if inString && ch == stringChar {
			inString = false
			current.WriteByte(ch)
			i++
			continue
		}

		// Statement delimiter.
		if !inString && ch == ';' {
			flush()
			i++
			continue
		}

		current.WriteByte(ch)
		i++
	}

	// A string or block comment left open at EOF means the input was truncated or
	// malformed; fail rather than silently dropping everything from the opener onward.
	if inString {
		return nil, errors.New("unterminated string literal")
	}
	if inBlockComment {
		return nil, errors.New("unterminated block comment")
	}

	flush() // trailing statement without a closing ';'
	return statements, nil
}
