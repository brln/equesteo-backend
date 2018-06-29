import jwt from 'jsonwebtoken'

import { configGet, TOP_SECRET_JWT_TOKEN } from "./config"

export const authenticator = (req, res, next) => {
  const authHeader = req.headers.authorization
  if (authHeader) {
    const token = req.headers.authorization.split('Bearer: ')[1]
    let decoded = undefined
    try {
      decoded = jwt.verify(token, configGet(TOP_SECRET_JWT_TOKEN))
    } catch (e) {}
    if (!token || !decoded) {
      return res.status(401).json({error: 'Invalid Authorization header'})
    }
    res.locals.userID = decoded.id
    res.locals.userEmail = decoded.email
    next()
  } else {
    return res.status(401).json({error: 'Authorization header required'})
  }
}
