import bcrypt from 'bcryptjs'
import bodyParser from 'body-parser'
import Slouch from 'couch-slouch'
import elasticsearch from 'elasticsearch'
import express from 'express'

import { authenticator } from '../auth'
import {
  configGet,
  COUCH_HOST,
  COUCH_PASSWORD,
  COUCH_USERNAME,
  ELASTICSEARCH_HOST,
  NICOLE_USER_ID,
} from "../config"
import { makeToken, pwResetCode, unixTimeNow } from '../helpers'
import DynamoDBService from '../services/dynamoDB'
import EmailerService from '../services/emailer'
import { USERS_DB, USERS_DESIGN_DOC } from "../design_docs/users"

const slouch = new Slouch(
  `http://${configGet(COUCH_USERNAME)}:${configGet(COUCH_PASSWORD)}@${configGet(COUCH_HOST)}`
)

const ESClient = new elasticsearch.Client({
  host: configGet(ELASTICSEARCH_HOST),
})

const USERS_TABLE_NAME = 'equesteo_users'
const FCM_TABLE_NAME = 'equesteo_fcm_tokens'

const router = express.Router()
router.use(bodyParser.json())

router.post('/login', async (req, res, next) => {
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
    found.nextToken = {S: token}
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


router.post('/', async (req, res, next) => {
  console.log('creating new user')
  const email = req.body.email
  const password = req.body.password

  const ddbService = new DynamoDBService()
  const found = await ddbService.getItem(USERS_TABLE_NAME, { email: {S: email }})
  if (found) {
    return res.status(400).json({'error': 'User already exists'})
  }
  const hashed = bcrypt.hashSync(password, bcrypt.genSaltSync(10));

  let newUser
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
  }).then(newUserRecord => {
    console.log('new user created')
    newUser = newUserRecord
    const newTraining = {
      "_id": `${newUser.id}_training`,
      "rides": [],
      "userID": newUser.id,
      "lastUpdate": unixTimeNow(),
      "type": "training"
    }
    console.log(newTraining)
    return slouch.doc.create(USERS_DB, newTraining)
  }).then(() => {
    console.log('training record created')
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

router.post('/getPWCode', async (req, res) => {
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

router.post('/exchangePWCode', async (req, res) => {
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
    return res.set('x-auth-token', token).json({
      id: foundID,
      following:  following.rows.map(f => f.value),
      followers: followers.rows.map(f => f.value),
      token
    })
  }
})

router.post('/changePW', authenticator, async (req, res) => {
  const email = res.locals.userEmail
  const password = req.body.password
  const hashed = bcrypt.hashSync(password, bcrypt.genSaltSync(10));

  const ddbService = new DynamoDBService()
  const found = await ddbService.getItem(USERS_TABLE_NAME, { email: {S: email }})

  found.password = {S: hashed}
  await ddbService.putItem(USERS_TABLE_NAME, found)

  return res.json({})
})

router.post('/setFCMToken', authenticator, (req, res, next) => {
  const id = req.body.id
  const fcmToken = req.body.token
  const ddbService = new DynamoDBService()
  if (fcmToken && id) {
    ddbService.getItem(FCM_TABLE_NAME, { id: {S: id }}).then(found => {
      if (found) {
        found.fcmToken = {S: fcmToken}
      } else {
        found = { id: {S: id}, fcmToken: {S: fcmToken}}
      }
      return ddbService.putItem(FCM_TABLE_NAME, found).then(() => {
        return res.json({})
      })
    }).catch(e => {
      next(e)
    })
  } else {
    return res.status(400)
  }
})

router.post('/setDistribution', authenticator, (req, res, next) => {
  const id = req.body.id
  const distribution = req.body.distribution
  const ddbService = new DynamoDBService()
  if (distribution && id) {
    ddbService.getItem(FCM_TABLE_NAME, { id: {S: id }}).then(found => {
      if (found) {
        found.distribution = {N: distribution}
      } else {
        found = { id: {S: id}, distribution: {N: distribution}}
      }
      return ddbService.putItem(FCM_TABLE_NAME, found).then(() => {
        return res.json({})
      })
    }).catch(e => {
      next(e)
    })
  } else {
    return res.status(400)
  }
})

router.get('/search', authenticator, async (req, res) => {
  const query = req.query.q
  const qResp = await ESClient.search({
    index: 'users',
    q: query
  })
  const docs = []
  for (let hit of qResp.hits.hits) {
    const doc = Object.assign({}, hit._source)
    doc._id = hit._id
    delete doc.email
    docs.push(doc)
  }
  return res.json(docs)
})

module.exports = router
