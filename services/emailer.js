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
      subject: 'Your Password Reset Code',
      text: token,
      html: `Your code is: ${token}`,
    };
    if (process.env.NODE_ENV === 'production') {
      await sgMail.send(msg);
    } else {
      console.log(msg)
    }
  }
}

