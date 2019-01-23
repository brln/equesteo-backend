import aws from 'aws-sdk'

export default class S3Service {
  constructor () {
    this.s3 = new aws.S3()
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
