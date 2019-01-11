import bodyParser from 'body-parser'
import express from 'express'
import multer from 'multer'

import { authenticator } from '../auth'
import PhotoUploader from '../services/photoUploader'

const router = express.Router()
router.use(bodyParser.urlencoded({ extended: true }))

function multipartMiddleware () {
  return multer().fields([{name: 'file', maxCount: 1}])
}

// remove this route when everyone > 0.48.0
router.post('/users/profilePhoto', authenticator, multipartMiddleware(), (req, res) => {
  console.log('user photo upload started')
  const file = req.files.file[0]
  PhotoUploader.uploadPhoto(file.buffer, file.originalname, 'equesteo-profile-photos-2').then(() => {
    res.json({})
  })
})

router.post('/photos/user', authenticator, multipartMiddleware(), (req, res) => {
  console.log('user photo upload started')
  const file = req.files.file[0]
  PhotoUploader.uploadPhoto(file.buffer, file.originalname, 'equesteo-profile-photos-2').then(() => {
    res.json({})
  })
})


// remove this route when everyone > 0.48.0
router.post('/users/horsePhoto', authenticator, multipartMiddleware(), (req, res) => {
  console.log('horse photo upload started')
  const file = req.files.file[0]
  PhotoUploader.uploadPhoto(file.buffer, file.originalname, 'equesteo-horse-photos').then(() => {
    res.json({})
  })

})

router.post('/photos/horse', authenticator, multipartMiddleware(), (req, res) => {
  console.log('horse photo upload started')
  const file = req.files.file[0]
  PhotoUploader.uploadPhoto(file.buffer, file.originalname, 'equesteo-horse-photos').then(() => {
    res.json({})
  })
})


// remove this route when everyone > 0.48.0
router.post('/users/ridePhoto', authenticator, multipartMiddleware(), (req, res) => {
  console.log('ride photo upload started')
  const file = req.files.file[0]
  PhotoUploader.uploadPhoto(file.buffer, file.originalname, 'equesteo-ride-photos-2').then(() => {
    res.json({})
  })

})

router.post('/photos/ride', authenticator, multipartMiddleware(), (req, res) => {
  console.log('ride photo upload started')
  const file = req.files.file[0]
  PhotoUploader.uploadPhoto(file.buffer, file.originalname, 'equesteo-ride-photos-2').then(() => {
    res.json({})
  })
})

module.exports = router
