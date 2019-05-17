import request from 'request'

export default class SlackService {
  static newSignup (email) {
    return SlackService.request(
      'https://hooks.slack.com/services/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',
      `Email: ${email}`
    )
  }

  static newFeedback (id, email, feedback) {
    return SlackService.request(
      'https://hooks.slack.com/services/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',
      `ID: ${id}\nEmail: ${email}\n=========================\n${feedback}\n==========================`
    )
  }

  static request (webhook, text) {
    const opts = {
      method: 'POST',
      uri: webhook,
      json: {text}
    }
    return new Promise((res, rej) => {
      request(opts, (err, response, respBody) => {
        console.log(respBody)
        if (err) {
          rej(err)
        } else {
          res(respBody)
        }
      })
    })
  }
}
