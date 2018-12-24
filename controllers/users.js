import bcrypt from 'bcryptjs'
import bodyParser from 'body-parser'
import Slouch from 'couch-slouch'

import { authenticator } from '../auth'
import {
  configGet,
  COUCH_HOST,
  COUCH_PASSWORD,
  COUCH_USERNAME,
  NICOLE_USER_ID,
} from "../config"
import { makeToken, pwResetCode, unixTimeNow } from '../helpers'
import DynamoDBService from '../services/dynamoDB'
import EmailerService from '../services/emailer'
import { USERS_DB, USERS_DESIGN_DOC } from "../design_docs/users"

const slouch = new Slouch(
  `http://${configGet(COUCH_USERNAME)}:${configGet(COUCH_PASSWORD)}@${configGet(COUCH_HOST)}`
);

const USERS_TABLE_NAME = 'equesteo_users'
const FCM_TABLE_NAME = 'equesteo_fcm_tokens'


export function users (app) {
  app.post('/users/login', bodyParser.json(), async (req, res, next) => {
    console.log('user logging in')
    const email = req.body.email
    const password = req.body.password

    const ddbService = new DynamoDBService()
    let found
    try {
      found = await ddbService.getItem(USERS_TABLE_NAME, { email: {S: email }})
    } catch (e) {
      console.log(e)
      next(e)
    }

    if (!password || !found || !bcrypt.compareSync(password, found.password.S)) {
      return res.status(401).json({'error': 'Wrong username/password'})
    } else if (!found.enabled || found.enabled.BOOL !== true) {
      return res.status(401).json({'error': 'Account is disabled.'})
    } else {
      const foundID = found.id.S
      const { token, refreshToken } = makeToken(foundID, email)

      found.refreshToken = {S: refreshToken}
      found.nextToken = {S:token}
      try {
        await ddbService.putItem(USERS_TABLE_NAME, found)
      } catch (e) {
        next(e)
      }

      const following = await slouch.db.viewArray(
        USERS_DB,
        USERS_DESIGN_DOC,
        'following',
        { key: `"${foundID}"`}
      )
      const followers = await slouch.db.viewArray(
        USERS_DB,
        USERS_DESIGN_DOC,
        'followers',
        { key: `"${foundID}"`}
      )
      console.log(token)
      res.set('x-auth-token', token).json({
        id: foundID,
        token, // remove this when everyone is on > 0.45.0
        followers: followers.rows.map(f => f.value),
        following: following.rows.map(f => f.value),
      })
    }
  })


  app.post('/users', bodyParser.json(), async (req, res, next) => {
    console.log('creating new user')
    const email = req.body.email
    const password = req.body.password

    const ddbService = new DynamoDBService()
    const found = await ddbService.getItem(USERS_TABLE_NAME, { email: {S: email }})
    if (found) {
      return res.status(400).json({'error': 'User already exists'})
    }
    const hashed = bcrypt.hashSync(password, bcrypt.genSaltSync(10));

    slouch.doc.create(USERS_DB, {
      firstName: null,
      lastName: null,
      aboutMe: null,
      profilePhotoID: null,
      photosByID: {},
      ridesDefaultPublic: true,
      type: 'user',
      createTime: unixTimeNow(),
      finishedFirstStart: false
    }).then(newUser => {
      console.log('new user created')
      return slouch.doc.create(USERS_DB, {
        "_id": `${newUser.id}_${configGet(NICOLE_USER_ID)}`,
        "followingID": configGet(NICOLE_USER_ID),
        "followerID": newUser.id,
        "deleted": false,
        "type": "follow"
      }).then(() => {
        console.log('nicole follow created')
        const { token, refreshToken } = makeToken(newUser.id, email)
        return ddbService.putItem(USERS_TABLE_NAME, {
          email: {S: email},
          password: {S: hashed},
          id: {S: newUser.id},
          enabled: {BOOL: true},
          refreshToken: {S: refreshToken},
          nextToken: {S:token}
        }).then(() => {
          console.log('ddb record created')
          res.set('x-auth-token', token).json({
            id: newUser.id,
            token, // remove this when everyone is on > 0.45.0
            following: [configGet(NICOLE_USER_ID)],
            followers: [],
          })
        })
      })
    }).catch(e => {
      next(e)
    })
  })

  app.post('/users/getPWCode', bodyParser.json(), async (req, res) => {
    const email = req.body.email
    const ddbService = new DynamoDBService()
    const found = await ddbService.getItem(USERS_TABLE_NAME, { email: {S: email }})
    if (found) {
      if (found.enabled.BOOL === false) {
        return res.status(401).json({'error': 'Account is disabled.'})
      } else {
        const code = pwResetCode()
        const noWhitespace = code.replace(/\s+/g, '')
        found.pwResetCode = {S: noWhitespace}
        await ddbService.putItem(USERS_TABLE_NAME, found)

        const emailer = new EmailerService()
        emailer.sendCode(email, code)
      }
    }
    return res.json({})
  })

  app.post('/users/exchangePWCode', bodyParser.json(), async (req, res) => {
    const email = req.body.email
    const code = req.body.code.replace(/\s+/g, '').toLowerCase()
    const ddbService = new DynamoDBService()
    const found = await ddbService.getItem(USERS_TABLE_NAME, { email: {S: email }})
    if (!found || !found.pwResetCode.S) {
      return res.status(401).json({'error': 'Wrong email/code.'})
    }
    const lowerNoWhitespace = found.pwResetCode.S.toLowerCase().replace(/\s+/g, '')
    if (code !== lowerNoWhitespace) {
      return res.status(401).json({'error': 'Wrong email/code.'})
    } else {
      const foundID = found.id.S
      const { token, refreshToken } = makeToken(foundID, email)
      const following = await slouch.db.viewArray(
        USERS_DB,
        USERS_DESIGN_DOC,
        'following',
        { key: `"${foundID}"`}
      )
      const followers = await slouch.db.viewArray(
        USERS_DB,
        USERS_DESIGN_DOC,
        'followers',
        { key: `"${foundID}"`}
      )

      found.pwResetCode = {NULL: true}
      found.refreshToken = { S: refreshToken }
      found.nextToken = {S: token}
      await ddbService.putItem(USERS_TABLE_NAME, found)
      return res.json({
        id: foundID,
        following:  following.rows.map(f => f.value),
        followers: followers.rows.map(f => f.value),
        token
      })
    }
  })

  app.post('/users/changePW', authenticator, bodyParser.json(), async (req, res) => {
    const email = res.locals.userEmail
    const password = req.body.password
    const hashed = bcrypt.hashSync(password, bcrypt.genSaltSync(10));

    const ddbService = new DynamoDBService()
    const found = await ddbService.getItem(USERS_TABLE_NAME, { email: {S: email }})

    found.password = {S: hashed}
    await ddbService.putItem(USERS_TABLE_NAME, found)

    return res.json({})
  })

  app.post('/users/setFCMToken', authenticator, bodyParser.json(), async (req, res) => {
    const id = req.body.id
    const fcmToken = req.body.token
    const ddbService = new DynamoDBService()
    let found = await ddbService.getItem(FCM_TABLE_NAME, { id: {S: id }})
    if (fcmToken) {
      if (found) {
        found.fcmToken = {S: fcmToken}
      } else {
        found = { id: {S: id}, fcmToken: {S: fcmToken}}
      }
      await ddbService.putItem(FCM_TABLE_NAME, found)
    }
    return res.json({})
  })

  app.post('/users/setDistribution', authenticator, bodyParser.json(), async (req, res) => {
    const id = req.body.id
    const distribution = req.body.distribution
    const ddbService = new DynamoDBService()
    let found = await ddbService.getItem(FCM_TABLE_NAME, { id: {S: id }})
    if (found) {
      found.distribution = {N: distribution}
    } else {
      found = { id: {S: id}, distribution: {N: distribution}}
    }
    await ddbService.putItem(FCM_TABLE_NAME, found)
    return res.json({})
  })
}