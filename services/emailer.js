import sgMail from '@sendgrid/mail'

import {
  configGet,
  SENDGRID_API_TOKEN,
} from "../config"
import Logging from './Logging'

export default class EmailerService {
  constructor () {
    sgMail.setApiKey(configGet(SENDGRID_API_TOKEN))
  }

  sendCode (email, token) {
    const downcase = token.replace(/\s+/g, '').toLowerCase()
    const b64email = encodeURIComponent(Buffer.from(email).toString('base64'))
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
      return sgMail.send(msg);
    } else {
      Logging.log(msg)
    }
  }


  sendFeedback (id, email, feedback) {
    const msg = {
      to: 'info@equesteo.com',
      from: 'info@equesteo.com',
      subject: 'New Feedback!',
      text: id + '\n\n\n' + email + '\n\n\n' + feedback,
    }
    if (process.env.NODE_ENV === 'production') {
      return sgMail.send(msg);
    } else {
      console.log(msg)
      return Promise.resolve()
    }
  }

  signupHappened (email) {
    const msg = {
      to: 'info@equesteo.com',
      from: 'info@equesteo.com',
      subject: 'New Signup!',
      text: email,
    }
    if (process.env.NODE_ENV === 'production') {
      return sgMail.send(msg);
    } else {
      return Promise.resolve()
    }
  }
}

