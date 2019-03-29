import aws from 'aws-sdk'

import Logging from './Logging'

export default class S3Service {
  constructor () {
    this.s3 = new aws.S3()
  }

  checkExists (Bucket, Key) {
    return new Promise((res, rej) => {
      this.s3.headObject({ Bucket, Key }, (err, data) => {
        if (err) {
          if (err.statusCode === 404) {
            res(false)
          } else {
            rej(err)
          }
        } else {
          Logging.log(data)
          res(true)
        }
      })
    })
  }

  get(Bucket, Key) {
    return new Promise((res, rej) => {
      this.s3.getObject({ Bucket, Key }, (err, data) => {
        if (err) {
          rej(err)
        } else {
          res(data)
        }
      })
    })
  }

  put(Bucket, Key, Body) {
    return new Promise ((res, rej) => {
      this.s3.putObject({ Bucket, Key, Body }, (s3Err, data) => {
        if (s3Err) {
          rej(s3Err)
        } else {
          res(data)
        }
      })
    })
  }
}
