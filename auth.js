import jwt from 'jsonwebtoken'

import { configGet, TOP_SECRET_JWT_TOKEN } from "./config"
import { makeToken, unixTimeNow } from './helpers'
import DynamoDBService from './services/dynamoDB'
import Logging from './services/Logging'

const USERS_TABLE_NAME = 'equesteo_users'
const TOKEN_EXPIRATION = 1000 * 60 * 18
const TOKEN_ALLOWED_OVERLAP = 1000 * 60 * 2

const refreshTokenCache = {}
const clearOldTokenTimeouts = {}
const fetchCount = {}

export const authenticator = (req, res, next) => {
  const authHeader = req.headers.authorization
  if (authHeader) {
    let token = req.headers.authorization.split('Bearer: ')[1]
    let decoded = undefined
    try {
      decoded = jwt.verify(token, configGet(TOP_SECRET_JWT_TOKEN))
    } catch (e) {
      return res.status(400).json({error: 'Invalid Token'})
    }
    res.locals.userID = decoded.id
    res.locals.userEmail = decoded.email

    if (!token || !decoded || !decoded.createdAt) {
      return res.status(401).json({error: 'Invalid Authorization header'})
    }

    const timeDiff = unixTimeNow() - decoded.createdAt
    if (timeDiff > TOKEN_EXPIRATION) {
      Logging.log('Token is expired, fetching a new one')
      const id = decoded.id
      const email = decoded.email
      const incomingRefreshToken = decoded.refreshToken
      const ddbService = new DynamoDBService()
      !fetchCount[email] ? fetchCount[email] = 1 : fetchCount[email] += 1
      ddbService.getItem(USERS_TABLE_NAME, { email: {S: email }}).then(found => {
        fetchCount[email] === 1 ? delete fetchCount[email] : fetchCount[email] -= 1
        if (!found) {
          return res.status(401).json({error: 'Account not found.'})
        }
        if (found.enabled.BOOL === false) {
          return res.status(401).json({error: 'Account is disabled.'})
        }

        const foundRefreshToken = found.refreshToken ? found.refreshToken.S : null
        const foundNextToken = found.nextToken.S
        const foundOldToken = found.oldToken ? found.oldToken.S : null

        Logging.log('incoming: ' + incomingRefreshToken)
        Logging.log('found: ' + foundRefreshToken)
        Logging.log('found old: ' + foundOldToken)
        if (incomingRefreshToken === foundRefreshToken) {
          // The token is expired but we have the correct refresh token, this
          // is the happy path.
          if (refreshTokenCache[incomingRefreshToken]) {
            // If multiple requests come in faster than we can get/save to
            // DynamoDB, we need to return the same new token to all of them
            // or we end up in a race condition for what new token gets set
            // on the client.
            Logging.log('token from cache')
            res.set('x-auth-token', refreshTokenCache[incomingRefreshToken])
            next()
          } else {
            const { token, refreshToken } = makeToken(id, email)
            Logging.log('making new token: ' + token)
            Logging.log('making new refreshToken: ' + refreshToken)
            refreshTokenCache[incomingRefreshToken] = token
            res.set('x-auth-token', token)
            found.refreshToken = { S: refreshToken }
            found.oldToken = { S: foundRefreshToken }
            found.nextToken = { S: token }
            ddbService.putItem(USERS_TABLE_NAME, found).then(() => {
              if (!fetchCount[email]) {
                delete refreshTokenCache[incomingRefreshToken]
              }
              Logging.log('token cache cleared')
              next()
            }).catch(e => { next(e) })
          }
        } else if (incomingRefreshToken === foundOldToken) {
          // Using the most recently expired token, but that has to be
          // okay because if many requests come in at once, the first ones
          // return with a new token, but the later ones still have the old
          // token, they should succeed and get the same token back that the
          // earlier ones did. This old token can be used for TOKEN_ALLOWED_OVERLAP
          // seconds after the first time it's used, then is destroyed.
          Logging.log('using an old token!')
          res.set('x-auth-token', foundNextToken)
          if (!clearOldTokenTimeouts[incomingRefreshToken]) {
            clearOldTokenTimeouts[incomingRefreshToken] = setTimeout(() => {
              Logging.log('clearing old token')
              ddbService.getItem(USERS_TABLE_NAME, { email: {S: email }}).then(foundAgain => {
                foundAgain.oldToken = { NULL: true }
                foundAgain.nextToken = { NULL: true }
                return ddbService.putItem(USERS_TABLE_NAME, found).then(() => {
                  delete clearOldTokenTimeouts[incomingRefreshToken]
                  Logging.log('old token cleared')
                })
              }).catch(e => { next(e) })
            }, TOKEN_ALLOWED_OVERLAP)
          }
          next()
        } else {
          Logging.log('attempted auth with expired token')
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

/***
 * Reason for fetchCount:
 *
 * 3 requests sent with token A
 * First request arrives, expired fetching a new one, fetch DDB
 * Next request arrives, expired fetching new one, fetch DDB
 * Third request arrives, expired fetching new one, fetch DDB
 *
 * First request DDB returns, incomingRefreshToken === foundRefreshToken, no token in cache, new token made, put on response start put to DDB
 *
 * Second request DDB returns, incomingRefreshToken === foundRefreshToken, token in cache, return same token
 *
 * First DDB put returns, token cache cleared, rest of response begins
 *
 * Third request DDB returns, incomingRefreshToken === foundRefreshToken, token not in cache, new token gets made and fucks it up
 */
