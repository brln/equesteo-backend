import bodyParser from 'body-parser'
import express from 'express'

import { authenticator } from '../auth'
import DynamoDBService from '../services/dynamoDB'
import { unixTimeNow } from '../helpers'

const router = express.Router()
router.use(bodyParser.json())

const HOOF_TRACKS_COORDS_TABLE_NAME = 'equesteo_hoof_tracks_coords'

router.post('/:htID/deleteCoords', authenticator, (req, res, next) => {
  const ddbService = new DynamoDBService()
  ddbService.deleteItem(HOOF_TRACKS_COORDS_TABLE_NAME, { htID: {S: req.params.htID }}).then(_ => {
    res.json({})
  })
})

router.post('/:htID/ping', authenticator, (req, res, next) => {
  const ddbService = new DynamoDBService()
  ddbService.getItem(HOOF_TRACKS_COORDS_TABLE_NAME, { htID: {S: req.params.htID }}).then(found => {
    if (found) {
      let rideData = JSON.parse(found.rideData.S)
      rideData.pingTime = unixTimeNow()
      const putItem = {
        htID: {S: req.params.htID},
        rideData: {S: JSON.stringify(rideData)}
      }
      return ddbService.putItem(HOOF_TRACKS_COORDS_TABLE_NAME, putItem)
    } else {
      const putItem = {
        htID: {S: req.params.htID},
        rideData: {S: JSON.stringify({
          pingTime: unixTimeNow(),
        })}
      }
      return ddbService.putItem(HOOF_TRACKS_COORDS_TABLE_NAME, putItem)
    }
  }).then(() => {
    res.json({})
  }).catch(e => {
    next(e)
  })
})

router.post('/:htID/postCoords', authenticator, (req, res, next) => {
  const ddbService = new DynamoDBService()
  ddbService.getItem(HOOF_TRACKS_COORDS_TABLE_NAME, { htID: {S: req.params.htID }}).then(found => {
    if (found) {
      let rideData = JSON.parse(found.rideData.S)
      const sameRide = rideData.rideStartTime === req.body.startTime
      if (sameRide) {
        rideData.coords = rideData.coords.concat(req.body.coords)
        rideData.pingTime = unixTimeNow()
      } else {
        rideData = {
          rideStartTime: req.body.startTime,
          coords: req.body.coords,
          pingTime: unixTimeNow(),
        }
      }
      const putItem = {
        htID: {S: req.params.htID},
        rideData: {S: JSON.stringify(rideData)}
      }
      return ddbService.putItem(HOOF_TRACKS_COORDS_TABLE_NAME, putItem)
    } else {
      const putItem = {
        htID: {S: req.params.htID},
        rideData: {S: JSON.stringify({
          rideStartTime: req.body.startTime,
          coords: req.body.coords,
            pingTime: unixTimeNow(),
        })}
      }
      return ddbService.putItem(HOOF_TRACKS_COORDS_TABLE_NAME, putItem)
    }
  }).then(() => {
    res.json({})
  }).catch(e => {
    next(e)
  })
})

module.exports = router
