import sgMail from '@sendgrid/mail'

import {
  configGet,
  SENDGRID_API_TOKEN,
} from "../config"

export default class EmailerService {
  constructor () {
    sgMail.setApiKey(configGet(SENDGRID_API_TOKEN))
  }

  async sendCode (email, token) {
    const msg = {
      to: email,
      from: 'donotreply@equesteo.com',
      subject: 'Your Login Link',
      text: token,
      html: `Click <a href=equesteo://login?token=${token.replace(/\s+/g, '')}>here</a> to be logged in. If you can't see the link, your code is: \n\n ${token}`,
    };
    if (process.env.NODE_ENV === 'production') {
      await sgMail.send(msg);
    } else {
      console.log(msg)
    }
  }
}

