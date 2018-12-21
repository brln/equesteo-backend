import jwt from 'jsonwebtoken'

import { configGet, TOP_SECRET_JWT_TOKEN } from "./config"
import { makeToken, unixTimeNow } from './helpers'
import DynamoDBService from './services/dynamoDB'

const USERS_TABLE_NAME = 'equesteo_users'
const TOKEN_EXPIRATION = 120000
const TOKEN_ALLOWED_OVERLAP = 10000

const refreshTokenCache = {}

export const authenticator = (req, res, next) => {
  const authHeader = req.headers.authorization
  if (authHeader) {
    let token = req.headers.authorization.split('Bearer: ')[1]
    let decoded = undefined
    try {
      decoded = jwt.verify(token, configGet(TOP_SECRET_JWT_TOKEN))
    } catch (e) {
      return res.status(400).send()
    }
    res.locals.userID = decoded.id
    res.locals.userEmail = decoded.email

    // Give old tokens a pass. When everyone > 0.45.0,
    // if (!token || !decoded || !decoded.createdAt)
    if (!token || !decoded) {
      return res.status(401).json({error: 'Invalid Authorization header'})
    }
    if (!decoded.createdAt) {
      console.log('using an ancient unlimited token')
      return next() // and remove this
    }

    const timeDiff = unixTimeNow() - decoded.createdAt
    if (timeDiff > TOKEN_EXPIRATION) {
      console.log('Token is expired, fetching a new one')
      // Token is expired, fetching a new one
      const id = decoded.id
      const email = decoded.email
      const incomingRefreshToken = decoded.refreshToken
      const ddbService = new DynamoDBService()
      ddbService.getItem(USERS_TABLE_NAME, { email: {S: email }}).then(found => {
        if (found.enabled.BOOL === false) {
          return res.status(401).json({error: 'Account is disabled.'})
        }

        const foundRefreshToken = found.refreshToken.S
        const foundOldToken = found.oldToken ? found.oldToken.S : null

        if (incomingRefreshToken === foundRefreshToken) {
          // Using the most recent refresh token
          if (refreshTokenCache[incomingRefreshToken]) {
            // If multiple requests come in faster than we can get/save to
            // DynamoDB, we need to return the same new token to all of them
            // or we end up in a race condition for what new token gets set
            // on the client.
            res.set('x-auth-token', refreshTokenCache[incomingRefreshToken])
            next()
          } else {
            const { token, refreshToken } = makeToken(id, email)
            refreshTokenCache[incomingRefreshToken] = token
            res.set('x-auth-token', token)
            found.refreshToken = { S: refreshToken }
            found.oldToken = { S: foundRefreshToken }
            ddbService.putItem(USERS_TABLE_NAME, found).then(() => {
              delete refreshTokenCache[incomingRefreshToken]
              next()
            })
          }
        } else if (incomingRefreshToken === foundOldToken) {
          // Using the most recently expired token, but that has to be
          // okay because if many requests come in at once, the first ones
          // return with a new token, but the later ones still have the old
          // token, they should succeed and get the same token back that the
          // earlier ones did. This old token can be used for TOKEN_ALLOWED_OVERLAP
          // seconds after the first time it's used, then is destroyed.
          console.log('using an old token!')
          const { token, refreshToken } = makeToken(id, email, foundRefreshToken)
          res.set('x-auth-token', token)
          setTimeout(() => {
            found.oldToken = { NULL: true }
            console.log('clearing old token')
            ddbService.putItem(USERS_TABLE_NAME, found).then(() => {
              console.log('old token cleared')
            }).catch(e => { next(e) })
          }, TOKEN_ALLOWED_OVERLAP)
          next()
        } else {
          console.log('attempted auth with expired token')
          return res.status(401).json({error: 'Bad Token.'})
        }
      }).catch(e => {
        next(e)
      })
    } else {
      res.set('x-auth-token', token)
      next()
    }
  } else {
    return res.status(401).json({error: 'Authorization header required'})
  }
}
