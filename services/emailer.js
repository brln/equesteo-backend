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
    const downcase = token.replace(/\s+/g, '').toLowerCase()
    const b64email = Buffer.from(email).toString('base64')
    const msg = {
      to: email,
      from: 'donotreply@equesteo.com',
      subject: 'Your Password Reset Code',
      text: token,
      html: `Your code is: <a href="equesteo://forgotpw?t=${downcase}&e=${b64email}">${token}</a>`,
    };
    if (process.env.NODE_ENV === 'production') {
      await sgMail.send(msg);
    } else {
      console.log(msg)
    }
  }
}

