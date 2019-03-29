import aws from 'aws-sdk'
import sharp from 'sharp'

import Logging from './Logging'

const s3 = new aws.S3()

export default class PhotoUploader {
  static uploadPhoto(fileBuffer, fileName, bucket, skipFull=false) {
    const sizes = {
      full: [1200, 1200],
      med: [600, 600],
      sm: [150, 150],
    }

    const uploads = []
    for (let sizeKey of Object.keys(sizes)) {
      let sizedFilename = fileName
      if (sizeKey !== 'full') {
        const splitupFilename = fileName.split('.')
        sizedFilename = `${splitupFilename[0]}_${sizeKey}.${splitupFilename[1]}`
      }

      if (!skipFull || (skipFull && sizeKey !== 'full')) {
        uploads.push(new Promise((res, rej) => {
          sharp(fileBuffer).resize(...sizes[sizeKey]).toBuffer().then(buffer => {
            const params = {
              Bucket: bucket,
              Key: sizedFilename,
              Body: buffer
            };
            s3.upload(params, (s3Err, data) => {
              if (s3Err) {
                rej(s3Err)
              } else {
                Logging.log(`File uploaded successfully at ${data.Location}`)
                res()
              }
            })
          }).catch(e => {
            rej(e)
          })
        }))
      }
    }
    return Promise.all(uploads)
  }
}