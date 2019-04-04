import express from 'express'
import * as Sentry from '@sentry/node'

import { authenticator } from '../auth'
import { configGet, COUCH_HOST, COUCH_USERNAME, COUCH_PASSWORD } from '../config'
import CouchService from '../services/Couch'
import DynamoDBService from '../services/dynamoDB'
import Logging from '../services/Logging'

const USERS_TABLE_NAME = 'equesteo_users'

const router = express.Router()

const couchService = new CouchService(
  configGet(COUCH_USERNAME),
  configGet(COUCH_PASSWORD),
  configGet(COUCH_HOST)
)

const HORSE_DB = 'horses'
const NOTIFICATIONS_DB = 'notifications'
const RIDE_DB = 'rides'
const USERS_DB = 'users'
const VALID_DBS = [
  HORSE_DB,
  NOTIFICATIONS_DB,
  RIDE_DB,
  USERS_DB
]
const DB_REG = `:db(${VALID_DBS.join('|')})`

const REQUIRED_FILTERS = {}
REQUIRED_FILTERS[HORSE_DB] = '_doc_ids'
REQUIRED_FILTERS[USERS_DB] = 'users/byUserIDs2'
REQUIRED_FILTERS[RIDE_DB] = 'rides/byUserIDs'
REQUIRED_FILTERS[NOTIFICATIONS_DB] = 'notifications/byUserIDs'


function checkDB (req, res, next) {
  if (VALID_DBS.includes(req.params.db)) {
    next()
  } else {
    res.sendStatus(401)
  }
}

function checkFilter(req, res, next) {
  const required = REQUIRED_FILTERS[req.params.db]
  if (!req.query.filter || req.query.filter !== required) {
    res.sendStatus(401)
  } else {
    next()
  }
}

router.get('/', authenticator, (req, res, next) => {
  req.pipe(couchService.getInfo()).pipe(res)
})

router.get(`/${DB_REG}/`, authenticator, checkDB, (req, res, next) => {
  req.pipe(couchService.getDBInfo(req.params.db)).pipe(res)
})

router.get(`/${DB_REG}/_local/:id`, authenticator, checkDB, (req, res, next) => {
  req.pipe(couchService.getLocalDoc(req.params.db, req.params.id, req.query)).pipe(res)
})

router.put(`/${DB_REG}/_local/:id`, authenticator, checkDB, (req, res, next) => {
  req.pipe(couchService.putLocalDoc(req.params.db, req.params.id, req.query)).pipe(res)
})

router.post(`/${DB_REG}/_revs_diff`, authenticator, checkDB, (req, res, next) => {
  req.pipe(couchService.postRevDiffs(req.params.db, req.query)).pipe(res)
})

router.get(`/${DB_REG}/_revs_diff`, authenticator, checkDB, (req, res, next) => {
  req.pipe(couchService.getRevDiffs(req.params.db, req.query)).pipe(res)
})

router.get(`/${DB_REG}/_design/:designDoc/_view/:view`, checkDB, authenticator, (req, res, next) => {
  req.pipe(couchService.getView(req.params.db, req.params.designDoc, req.params.view, req.query)).pipe(res)
})

router.post(`/${DB_REG}/_design/:designDoc/_view/:view`, checkDB, authenticator, (req, res, next) => {
  // Same thing as GET view but posts the ids when they don`t fit in url
  req.pipe(couchService.postView(req.params.db, req.params.designDoc, req.params.view, req.query)).pipe(res)
})

router.post(`/${DB_REG}/_changes`, authenticator, checkDB, (req, res, next) => {
  req.pipe(couchService.postChanges(req.params.db, req.query)).pipe(res)
})

router.get(`/${DB_REG}/_changes`, authenticator, checkDB, checkFilter, (req, res, next) => {
  req.pipe(couchService.getChanges(req.params.db, req.query)).pipe(res)
})

router.post(`/${DB_REG}/_all_docs`, authenticator, checkDB, (req, res, next) => {
  req.pipe(couchService.postAllDocs(req.params.db, req.query)).pipe(res)
})

router.post(`/${DB_REG}/_bulk_docs`, authenticator, checkDB, (req, res, next) => {
  req.pipe(couchService.postBulkDocs(req.params.db, req.query)).pipe(res)
})

router.post(`/${DB_REG}/_bulk_get`, authenticator, checkDB, (req, res, next) => {
  req.pipe(couchService.postBulkGet(req.params.db, req.query)).pipe(res)
})

router.get(`/${DB_REG}/:id`, authenticator, checkDB, (req, res, next) => {
  req.pipe(couchService.getItem(req.params.db, req.params.id, req.query)).pipe(res)
})

function captureEvent (id) {
  Sentry.captureMessage(`CouchdDB Anomaly, major fucking problem: ${id}`, Sentry.Severity.Critical)
}

function disableAccount (email) {
  const ddbService = new DynamoDBService()
  ddbService.getItem(USERS_TABLE_NAME, { email: {S: email }}).then(item => {
    item.enabled = { BOOL: false }
    return ddbService.putItem(USERS_TABLE_NAME, item)
  }).catch(e => {
    Logging.log(e, 'error disabling nefarious account')
  })
}

function badRoute (req, res, next) {
  captureEvent(res.locals.userID)
  disableAccount(res.locals.userEmail)
  res.sendStatus(401)
}

router.get('/*', authenticator, badRoute)
router.post('/*', authenticator, badRoute)
router.put('/*', authenticator, badRoute)
router.patch('/*', authenticator, badRoute)
router.delete('/*', authenticator, badRoute)



module.exports = router
