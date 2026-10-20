/**
 * The one form an email address is stored and looked up in: trimmed and
 * lowercased, nothing else. Not validator's normalizeEmail(), which also
 * strips +tags and Gmail dots: the CLI didn't, so an admin it created as
 * someone+tag@gmail.com could never sign in.
 */
function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : email;
}

module.exports = { normalizeEmail };
