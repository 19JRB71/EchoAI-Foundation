const jwt = require("jsonwebtoken");

/**
 * Auth middleware: verifies a JWT from the Authorization header.
 * Expects a header of the form:  Authorization: Bearer <token>
 *
 * - Missing or malformed token   -> 401
 * - Invalid or expired token     -> 401
 * - Valid token                  -> attaches decoded payload to req.user and continues
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: no token provided" });
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Unauthorized: no token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized: invalid or expired token" });
  }
}

module.exports = authMiddleware;
