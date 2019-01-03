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
      from: 'info@equesteo.com',
      subject: 'Your Password Reset Code',
      text: `Your password reset code is: ${token}. Please contact us if you have any problems. info@equesteo.com`,
      templateId: 'd-6d31a5baf5ab4e6681b7a3e80f5e7be7',
      dynamic_template_data: {
        token: token,
        link: `equesteo://forgotpw?t=${downcase}&e=${b64email}`
      }
    }
    if (process.env.NODE_ENV === 'production') {
      await sgMail.send(msg);
    } else {
      console.log(msg)
    }
  }
}

