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
  MOST_RECENT_DISTRO,
  NICOLE_USER_ID,
} from "../config"
import { htID, makeToken, pwResetCode, unixTimeNow } from '../helpers'
import CouchService from '../services/Couch'
import DynamoDBService from '../services/dynamoDB'
import EmailerService from '../services/emailer'
import { USERS_DB, USERS_DESIGN_DOC } from "../design_docs/users"
import Logging from '../services/Logging'

const couchService = new CouchService(
  configGet(COUCH_USERNAME),
  configGet(COUCH_PASSWORD),
  configGet(COUCH_HOST)
)
const slouch = new Slouch(
  `http://${configGet(COUCH_USERNAME)}:${configGet(COUCH_PASSWORD)}@${configGet(COUCH_HOST)}`
)

const ESClient = new elasticsearch.Client({
  host: configGet(ELASTICSEARCH_HOST),
})

const emailer = new EmailerService()

const USERS_TABLE_NAME = 'equesteo_users'
const FCM_TABLE_NAME = 'equesteo_fcm_tokens'
const HOOF_TRACKS_IDS_TABLE_NAME = 'equesteo_hoof_tracks_ids'
const HOOF_TRACKS_COORDS_TABLE_NAME = 'equesteo_hoof_tracks_coords'

const router = express.Router()
router.use(bodyParser.json())

router.post('/login', async (req, res, next) => {
  Logging.log('user logging in')
  const email = req.body.email
  const password = req.body.password

  const ddbService = new DynamoDBService()
  let foundID
  let token
  let refreshToken
  ddbService.getItem(USERS_TABLE_NAME, { email: {S: email }}).then(found => {
    if (!password || !found || !bcrypt.compareSync(password, found.password.S)) {
      res.status(401).json({'error': 'Wrong username/password'})
    } else if (!found.enabled || found.enabled.BOOL !== true) {
      res.status(401).json({'error': 'Account is disabled.'})
    } else {
      foundID = found.id.S
      const madeTokens = makeToken(foundID, email)
      token = madeTokens.token
      refreshToken = madeTokens.refreshToken
      found.refreshToken = {S: refreshToken}
      found.nextToken = {S: token}
      found.pwResetCode = {NULL: true}
      let following
      let followers
      return ddbService.putItem(USERS_TABLE_NAME, found).then(() => {
        return slouch.db.viewArray(
          USERS_DB,
          USERS_DESIGN_DOC,
          'following',
          { key: `"${foundID}"`}
        )
      }).then(_following => {
        following = _following
        return slouch.db.viewArray(
          USERS_DB,
          USERS_DESIGN_DOC,
          'followers',
          { key: `"${foundID}"`}
        )
      }).then(_followers => {
        followers = _followers
        res.set('x-auth-token', token).json({
          id: foundID,
          followers: followers.rows.map(f => f.value),
          following: following.rows.map(f => f.value),
        })
      })
    }
  }).catch(e => {
    next(e)
  })
})


router.post('/', (req, res, next) => {
  Logging.log('creating new user')
  const email = req.body.email
  const password = req.body.password

  const ddbService = new DynamoDBService()
  ddbService.getItem(USERS_TABLE_NAME, { email: { S: email }}).then(found => {
    if (found) {
      res.status(400).json({'error': 'User already exists'})
    } else {
      let newUser
      const hashed = bcrypt.hashSync(password, bcrypt.genSaltSync(10));
      let globalToken
      return slouch.doc.create(USERS_DB, {
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
        Logging.log('new user created')
        newUser = newUserRecord
        return couchService.createUser(newUser.id)
      }).then(() => {
        Logging.log('new couch user created')
        const newTraining = {
          "_id": `${newUser.id}_training`,
          "rides": [],
          "userID": newUser.id,
          "lastUpdate": unixTimeNow(),
          "type": "training"
        }
        return slouch.doc.create(USERS_DB, newTraining)
      }).then(() => {
        Logging.log('training record created')
        return slouch.doc.create(USERS_DB, {
          "_id": `${newUser.id}_${configGet(NICOLE_USER_ID)}`,
          "followingID": configGet(NICOLE_USER_ID),
          "followerID": newUser.id,
          "deleted": false,
          "type": "follow"
        })
      }).then(() => {
        return slouch.doc.create(USERS_DB, {
          "_id": `${configGet(NICOLE_USER_ID)}_${newUser.id}`,
          "followingID": newUser.id,
          "followerID": configGet(NICOLE_USER_ID),
          "deleted": false,
          "type": "follow"
        })
      }).then(() => {
        const { token, refreshToken } = makeToken(newUser.id, email)
        globalToken = token
        return ddbService.putItem(USERS_TABLE_NAME, {
          email: {S: email},
          password: {S: hashed},
          id: {S: newUser.id},
          enabled: {BOOL: true},
          refreshToken: {S: refreshToken},
          nextToken: {S:token},
          acceptedTOSVersion: {S: '1'},
        })
      }).then(() => {
        Logging.log('ddb record created')

        res.set('x-auth-token', globalToken).json({
          id: newUser.id,
          following: [configGet(NICOLE_USER_ID)],
          followers: [],
        })

        const emailer = new EmailerService()
        Logging.log(email)
        return emailer.signupHappened(email)
      })
    }
  }).catch(e => {
    next(e)
  })
})

router.post('/getPWCode', async (req, res, next) => {
  const email = req.body.email
  const ddbService = new DynamoDBService()
  ddbService.getItem(USERS_TABLE_NAME, { email: {S: email }}).then(found => {
    if (!found) {
      console.log(`email not found: ${email}`)
      res.set('x-auth-token', null).json({})
    } else if (found && found.enabled && found.enabled.BOOL === false) {
      res.status(401).json({'error': 'Account is disabled.'})
    } else {
      let code
      let save
      if (found.pwResetCode && found.pwResetCode.S) {
        code = found.pwResetCode.S
        save = Promise.resolve()
      } else {
        code = pwResetCode()
        const noWhitespace = code.replace(/\s+/g, '')
        found.pwResetCode = {S: noWhitespace}
        save = ddbService.putItem(USERS_TABLE_NAME, found)
      }
      console.log(code)
      return save.then(() => {
        return emailer.sendCode(email, code)
      }).then(() => {
        res.set('x-auth-token', null).json({})
      })
    }
  }).catch(e => {
    next(e)
  })
})

// remove when deprecating < 133
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

// remove when deprecating < 133
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

router.post('/exchangePWCode2', (req, res, next) => {
  const email = req.body.email
  const code = req.body.code.replace(/\s+/g, '').toLowerCase()
  if (email && code) {
    const ddbService = new DynamoDBService()
    ddbService.getItem(USERS_TABLE_NAME, { email: {S: email }}).then(found => {
      if (!found || !found.pwResetCode.S) {
        res.status(401).json({'error': 'Wrong email/code.'})
      } else {
        console.log(found)
        const lowerNoWhitespace = found.pwResetCode.S.toLowerCase().replace(/\s+/g, '')
        if (code !== lowerNoWhitespace) {
          res.status(401).json({'error': 'Wrong email/code.'})
        } else {
          const foundID = found.id.S
          const { token, refreshToken } = makeToken(foundID, email)
          found.pwResetCode = {NULL: true}
          found.refreshToken = { S: refreshToken }
          found.nextToken = {S: token}
          return ddbService.putItem(USERS_TABLE_NAME, found).then(() => {
            res.set('x-auth-token', token).json({})
          })
        }
      }
    }).catch(e => {
      res.set('x-auth-token', null)
      next(e)
    })
  } else {
    res.status(400).json({error: 'Need an email and a code.'})
  }
})

router.post('/changePW2', authenticator, (req, res, next) => {
  const email = res.locals.userEmail
  const password = req.body.password
  const hashed = bcrypt.hashSync(password, bcrypt.genSaltSync(10));

  const ddbService = new DynamoDBService()
  let following
  ddbService.getItem(USERS_TABLE_NAME, { email: {S: email }}).then(found => {
    if (!found) {
      res.status(401).json({'error': 'User does not exist'})
    } else {
      const foundID = found.id.S
      found.password = {S: hashed}
      return ddbService.putItem(USERS_TABLE_NAME, found).then(() => {
        return slouch.db.viewArray(
          USERS_DB,
          USERS_DESIGN_DOC,
          'following',
          { key: `"${foundID}"`}
        )
      }).then(_following => {
        following = _following
        return slouch.db.viewArray(
          USERS_DB,
          USERS_DESIGN_DOC,
          'followers',
          { key: `"${foundID}"`}
        )
      }).then(followers => {
        res.json({
          id: foundID,
          following:  following.rows.map(f => f.value),
          followers: followers.rows.map(f => f.value),
        })
      })
    }
  }).catch(e => {
    next(e)
  })
})

router.post('/setFCMToken', authenticator, (req, res, next) => {
  const id = req.body.id
  const fcmToken = req.body.token
  const platform = req.body.platform
  const ddbService = new DynamoDBService()
  if (fcmToken && id) {
    ddbService.getItem(FCM_TABLE_NAME, { id: {S: id }}).then(found => {
      if (found) {
        found.fcmToken = {S: fcmToken}
      } else {
        found = { id: {S: id}, fcmToken: {S: fcmToken}}
      }

      if (platform) {
        found['platform'] = {S: platform}
      }
      return ddbService.putItem(FCM_TABLE_NAME, found).then(() => {
        return res.json({})
      })
    }).catch(e => {
      next(e)
    })
  } else {
    return res.status(400).json({'error': 'Bad ID or Token'})
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
        return res.json({mostRecent: configGet(MOST_RECENT_DISTRO)})
      })
    }).catch(e => {
      next(e)
    })
  } else {
    return res.status(400).json({'error': 'Bad ID or Distribution'})
  }
})

router.post('/feedback', authenticator, (req, res, next) => {
  const email = res.locals.userEmail
  const id = req.body.id
  const feedback = req.body.feedback
  const emailService = new EmailerService()
  emailService.sendFeedback(id, email, feedback).then(() => {
    res.json({})
  })
})

router.get('/hoofTracksID', authenticator, (req, res, next) => {
  const ddbService = new DynamoDBService()
  let foundID
  ddbService.getItem(HOOF_TRACKS_IDS_TABLE_NAME, { userID: {S: res.locals.userID }}).then(found => {
    if (found) {
      foundID = found.htID.S
      return Promise.resolve()
    } else {
      foundID = htID()
      const putItem = {
        userID: {S: res.locals.userID},
        htID: {S: foundID}
      }
      return ddbService.putItem(HOOF_TRACKS_IDS_TABLE_NAME, putItem)
    }
  }).then(() => {
    res.json({htID: foundID})
  }).catch(e => {
    next(e)
  })
})

router.get('/resetHoofTracksID', authenticator, (req, res, next) => {
  const ddbService = new DynamoDBService()
  let newID
  ddbService.getItem(HOOF_TRACKS_IDS_TABLE_NAME, { userID: {S: res.locals.userID }}).then(found => {
    if (found && found.htID) {
      ddbService.deleteItem(HOOF_TRACKS_COORDS_TABLE_NAME, { htID: {S: found.htID.S }}).catch(e => {console.log(e)})
    }
    newID = htID()
    const putItem = {
      userID: {S: res.locals.userID},
      htID: {S: newID}
    }
    return ddbService.putItem(HOOF_TRACKS_IDS_TABLE_NAME, putItem)
  }).then(() => {
    res.json({htID: newID})
  }).catch(e => {
    next(e)
  })
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
