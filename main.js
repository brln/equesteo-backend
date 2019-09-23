import aws from 'aws-sdk'
import express from 'express'
import gcm from 'node-gcm'
import morgan from 'morgan'
import Slouch from 'couch-slouch'
import elasticsearch from 'elasticsearch'
import * as Sentry from '@sentry/node'

import { authenticator } from './auth'
import {
  configGet,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  COUCH_HOST,
  COUCH_PASSWORD,
  COUCH_USERNAME,
  ELASTICSEARCH_HOST,
  GCM_API_KEY,
  NODE_ENV, NICOLE_USER_ID,
} from "./config"
import {
  couchProxyRouter,
  hoofTracksRouter,
  photosRouter,
  sharableRouter,
  usersRouter
} from './controllers'
import { createUsersDesignDoc, USERS_DB } from "./design_docs/users"
import { createHorsesDesignDoc, HORSES_DB } from "./design_docs/horses"
import { createRidesDesignDoc, RIDES_DB } from './design_docs/rides'
import { NOTIFICATIONS_DB } from './design_docs/notifications'
import { createNotificationsDesignDoc } from "./design_docs/notifications"
import CouchService from './services/Couch'

import startRideChangeIterator from './ChangeIterators/rides'
import startUsersChangeIterator from './ChangeIterators/users'
import DynamoDBService from './services/dynamoDB'
import Logging from './services/Logging'
import RideMap from './services/RideMap'


const app = express()

const logger = morgan(function (tokens, req, res) {
  return [
    tokens.date(req, res, 'iso'), '-',
    tokens['id'](res), '-',
    tokens.status(req, res),
    tokens.method(req, res),
    tokens.url(req, res),
    tokens.res(req, res, 'content-length'), '-',
    tokens['response-time'](req, res), 'ms',
  ].join(' ')
})
morgan.token('id', function getId (res) {
  return res.locals ? res.locals.userID : null
})
app.use(logger)

if (configGet(NODE_ENV) !== 'local') {
  Sentry.init({dsn: 'https://04b0f2944b3d43af8fc7d039a8bb6359@sentry.io/1305626'})
  app.use(Sentry.Handlers.requestHandler())
}

aws.config.update({
  secretAccessKey: configGet(AWS_SECRET_ACCESS_KEY),
  accessKeyId: configGet(AWS_ACCESS_KEY_ID),
  region: 'us-west-1'
});

app.use(express.static('static'))

const slouch = new Slouch(
  `http://${configGet(COUCH_USERNAME)}:${configGet(COUCH_PASSWORD)}@${configGet(COUCH_HOST)}`
);
createUsersDesignDoc(slouch)
createHorsesDesignDoc(slouch)
createRidesDesignDoc(slouch)
createNotificationsDesignDoc(slouch)

// Create endpoints
app.use('/couchProxy', couchProxyRouter)
app.use('/users', usersRouter)
app.use('/hoofTracks', hoofTracksRouter)
app.use('/photos', photosRouter)
app.use('', sharableRouter)

const ESClient = new elasticsearch.Client({
  host: configGet(ELASTICSEARCH_HOST),
})

const gcmClient = new gcm.Sender(configGet(GCM_API_KEY));

const ddbService = new DynamoDBService()

startUsersChangeIterator(ESClient, slouch)
startRideChangeIterator(slouch, gcmClient, ddbService)

app.get('/', (req, res) => {
  res.redirect('https://equesteo.com')
})

app.get('/errorTest', (req, res) => {
  throw new Error('Broke!');
})

app.get('/unauthorizedTest', (req, res) => {
  Logging.log('unauthorized test')
  return res.status(401).json({error: 'Invalid Authorization header'})
})

app.get('/checkAuth', authenticator, (req, res) => {
  return res.json({})
})

app.get('/checkConnection', authenticator, (req, res) => {
  return res.json({connected: true})
})

app.get('/checkConnection2', (req, res) => {
  return res.json({connected: true})
})

app.get('/rideMap/:url', (req, res, next) => {
  const success = (imageData) => {
    res.setHeader("content-type", "image/png")
    return res.send(imageData)
  }

  const error = () => {
    return res.sendStatus(400)
  }
  const decoded = new Buffer(req.params.url, 'base64').toString('ascii')
  RideMap.getOrFetch(decoded, error, success)
})

app.get('/unfollow', (req, res) => {
  const couchService = new CouchService(
    configGet(COUCH_USERNAME),
    configGet(COUCH_PASSWORD),
    configGet(COUCH_HOST)
  )
  couchService.request('GET', `/users/_all_docs`, {include_docs: true}, false).then(resp => {
    let request = Promise.resolve()
    for (let row of resp.rows) {
      const doc = row.doc
      if (doc.type === 'follow' && doc.followerID === configGet(NICOLE_USER_ID)) {
        doc.deleted = true
        request = request.then(() => {
          return couchService.request('put', `/users/${doc._id}`, {}, false, doc).then(resp => {
            console.log(resp)
          }).catch(e => {
            console.log('error', e)
          })
        })
      }
    }
    request.then(() => {
      res.json({})
    })
  })
})

app.get('/replicateProd', async (req, res) => {
  if (configGet(NODE_ENV) !== 'local') {
    return res.json({'not for': "you"})
  }
  Logging.log('destroying local DBs')
  try {
    const destroys = [
      slouch.db.destroy(RIDES_DB),
      slouch.db.destroy(USERS_DB),
      slouch.db.destroy(HORSES_DB),
      slouch.db.destroy(NOTIFICATIONS_DB),
    ]
    try {
      await Promise.all(destroys)
    } catch (e) {
      if (e.error !== 'not_found') {
        throw e
      }
    }

    Logging.log('recreating local dbs')
    const creates =[
      slouch.db.create(RIDES_DB),
      slouch.db.create(USERS_DB),
      slouch.db.create(HORSES_DB),
      slouch.db.create(NOTIFICATIONS_DB),
    ]
    try {
      await Promise.all(creates)
    } catch (e) {
      Logging.log('wtf')
      throw e
    }

    const prodCouch = `http://equesteo:${process.env.PROD_COUCH_PASSWORD}@13.56.191.108:5984/`
    const dbs = ['horses', 'rides', 'users', 'notifications']

    const replications = []
    for (let db of dbs) {
      Logging.log(`starting replication on ${db}`)
      replications.push(slouch.db.replicate({
        source: prodCouch + db,
        target: db
      }))
    }
    await Promise.all(replications)
    Logging.log('replications complete')

    const tableName = 'equesteo_users'
    const ddbService = new DynamoDBService()
    Logging.log('deleting dynamoDB users table')
    try{
      await ddbService.deleteTable(tableName)
    } catch (e) {
      Logging.log('skipping delete')
    }
    Logging.log('creating dynamoDB users table')
    await ddbService.createTable('email', 'S', tableName)

    const prodDDBService = new DynamoDBService('production')
    const allItems = await prodDDBService.getAllItems(tableName)
    const putPromises = []
    for (let item of allItems) {
      const putItem = {
        password: {S: '$2a$10$Ds3tCqSgH0J1RntA7YOJVOy5ts6Jvk1GTYlHtyWLNCd3aEf5RoMKa'},
        id: {S: item.id},
        email: {S: item.email},
        enabled: {BOOL: true},
        refreshToken: {NULL: true}
      }
      putPromises.push(ddbService.putItem(tableName, putItem))
    }
    await Promise.all(putPromises)
  }
  catch (e) {
    Logging.log(e)
    return res.json({'error': e.toString()})
  }
  return res.json({'done': "now"})
})

app.get('/createCouchUsers', (req, res, next) => {
  if (configGet(NODE_ENV) !== 'local') {
    return res.json({'not for': "you"})
  }
  const usersTable = 'equesteo_users'
  const couchService = new CouchService(
    configGet(COUCH_USERNAME),
    configGet(COUCH_PASSWORD),
    configGet(COUCH_HOST)
  )
  ddbService.getAllItems(usersTable).then(users => {
    let lastPromise = Promise.resolve()
    for (let user of users) {
      const id = user.id
      lastPromise = lastPromise.then(() => {
        return couchService.getUser(id).then(found => {
          if (!found.error) {
            console.log('already exists')
            return Promise.resolve()
          } else if (found.error === 'not_found') {
            console.log('making: ' + id)
            return couchService.createUser(id)
          } else {
            throw Error('wut?')
          }
        })
      })
    }
    return lastPromise.then(resp => {
      return res.json({all: 'done'})
    })
  }).catch(e => {
    next(e)
  })
})

if (configGet(NODE_ENV) !== 'local') {
  app.use(Sentry.Handlers.errorHandler());
}

const errorHandler = (err, req, res, next) => {
  Logging.logError(err);
  res.status(500).json({'error': '500 Internal Server Error'})
};

app.use(errorHandler)

app.use(function (req, res, next) {
  res.status(404).json({'error': '404 Not Found'})
})

app.listen(process.env.PORT || 8080, '0.0.0.0', function () {
  Logging.log('Example app listening on port 8080!');
});

