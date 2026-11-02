// Package redact masks the userinfo of any URL inside a message before the message reaches a log,
// a state file or the operator's screen.
//
// It exists for the proxy. The console's outbound clients follow HTTPS_PROXY, and a proxy that
// needs a login is named as http://user:pass@host:port. A transport error can quote that URL whole
// — Go's own "invalid proxy address" does — and console-init copies transport errors into a
// world-readable state file the console UI renders. The masking is a pattern over the text, not a
// parse, because the URL arrives embedded in a sentence some other package wrote.
package redact

import "regexp"

// userinfo matches the userinfo of a URL: everything between "://" and the last "@" that comes
// before the first "/", "?", "#" or whitespace. Running to the last "@" masks a password that
// carries a raw "@"; the "/", "?" and "#" bounds keep a path, query or fragment that happens to
// carry an "@" (a mail address, say) untouched; the whitespace bound keeps the match inside one URL.
var userinfo = regexp.MustCompile(`://[^/?#\s]*@`)

// String returns s with the userinfo of every URL in it replaced by "***".
func String(s string) string {
	return userinfo.ReplaceAllString(s, "://***@")
}

// Error returns err with its message redacted, or err itself when there was nothing to mask. The
// result unwraps to err, so errors.Is still sees a cancelled context or a timeout through it.
// The unwrapped error still carries the raw message, so callers must not log an unwrapped error.
func Error(err error) error {
	if err == nil {
		return nil
	}
	msg := String(err.Error())
	if msg == err.Error() {
		return err
	}
	return &redacted{msg: msg, err: err}
}

type redacted struct {
	msg string
	err error
}

func (r *redacted) Error() string { return r.msg }
func (r *redacted) Unwrap() error { return r.err }
