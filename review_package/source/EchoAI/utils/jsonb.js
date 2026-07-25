/**
 * Safely coerce an arbitrary request value into a parameter suitable for a
 * Postgres `::jsonb` column.
 *
 * Postgres rejects a bare string like `small business owners` with
 * "invalid input syntax for type json" because valid JSON text requires the
 * string to be quoted. This helper guarantees the returned value is always
 * either NULL or valid JSON text:
 *   - null / undefined / blank        -> null (clears the column)
 *   - object / array                  -> JSON.stringify(value)
 *   - a JSON object/array *literal*   -> passed through unchanged
 *   - any other string (plain text)   -> JSON.stringify(value) (quoted string)
 */
function toJsonbParam(value) {
  if (value === undefined || value === null) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        JSON.parse(trimmed);
        return trimmed; // already a well-formed JSON object/array literal
      } catch {
        // looked like JSON but isn't — fall through and store as a string value
      }
    }
    return JSON.stringify(value); // plain text -> valid quoted JSON string
  }

  return JSON.stringify(value);
}

module.exports = { toJsonbParam };
