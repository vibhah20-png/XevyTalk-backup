import jwt from "jsonwebtoken";

export function authenticateJWT(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // attach user info
        next();
    } catch (err) {
        return res.status(403).json({ message: "Invalid or expired token" });
    }
}

export function signToken(user) {
    return jwt.sign(
        {
            id: user.id || user._id,
            username: user.username,
            email: user.email,
            isAdmin: user.isAdmin
        },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );
}

// Alias for backward compatibility if needed (though we updated routes to use authenticateJWT)
export const auth = authenticateJWT;
