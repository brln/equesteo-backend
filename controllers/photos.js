import bodyParser from 'body-parser'
import express from 'express'
import multer from 'multer'

import Logging from '../services/Logging'

import { authenticator } from '../auth'
import PhotoUploader from '../services/photoUploader'

const router = express.Router()
router.use(bodyParser.urlencoded({ extended: true }))

function multipartMiddleware () {
  return multer().fields([{name: 'file', maxCount: 1}])
}

router.post('/photos/user', authenticator, multipartMiddleware(), (req, res) => {
  Logging.log('user photo upload started')
  const file = req.files.file[0]
  PhotoUploader.uploadPhoto(file.buffer, file.originalname, 'equesteo-profile-photos-2').then(() => {
    res.json({})
  })
})


router.post('/photos/horse', authenticator, multipartMiddleware(), (req, res) => {
  Logging.log('horse photo upload started')
  const file = req.files.file[0]
  PhotoUploader.uploadPhoto(file.buffer, file.originalname, 'equesteo-horse-photos').then(() => {
    res.json({})
  })
})


router.post('/photos/ride', authenticator, multipartMiddleware(), (req, res) => {
  Logging.log('ride photo upload started')
  const file = req.files.file[0]
  PhotoUploader.uploadPhoto(file.buffer, file.originalname, 'equesteo-ride-photos-2').then(() => {
    res.json({})
  })
})

module.exports = router
