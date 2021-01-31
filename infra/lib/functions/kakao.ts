import axios from 'axios'
import * as AWS from 'aws-sdk'
import { v4 as uuid4 } from 'uuid'
import * as awsLambda from 'aws-lambda'

const UserPoolId = process.env['USER_POOL_ID']!
const ClientId = process.env['CLIENT_ID']!
const idp = new AWS.CognitoIdentityServiceProvider({ region: 'ap-northeast-2' })

const Provider = 'Kakao'

export interface IUserAttr {
  Name: string,
  Value?: string
}

export interface IBody {
  access_token: string
  user_attrs?: IUserAttr[]
}

export const handler = async (event: awsLambda.APIGatewayProxyEventV2, context: any): Promise<awsLambda.APIGatewayProxyResultV2> => {
  console.log(event)

  if (!event.body) {
    return {
      statusCode: 400,
      body: 'Empty Body'
    }
  }

  const body = <IBody>JSON.parse(event.body)

  let email
  try {
    email = await getKakaoEmail(body.access_token)
  } catch (err) {
    console.error(err)
    return {
      statusCode: 401,
      body: 'Invalid AccessToken'
    }
  }

  let Username = await getUsername(email)
  if (!Username) {
    console.log('create new user')
    const UserAttributes = body.user_attrs || []
    UserAttributes.push({
      Name: 'email',
      Value: email,
    })

    const resp = await idp.signUp({
      ClientId,
      Username: email,
      Password: uuid4(),
      UserAttributes,
      ClientMetadata: {
        provider: Provider,
      }
    }).promise()
    Username = resp.UserSub
    console.log('user is created')

    await idp.adminAddUserToGroup({
      UserPoolId,
      Username,
      GroupName: `${UserPoolId}_${Provider}`,
    }).promise()
    console.log('user is added to group')
  }
  console.log('login user')

  const Password = uuid4()
  await idp.adminSetUserPassword({
    UserPoolId,
    Username,
    Password,
    Permanent: true,
  }).promise()
  const authResult = await idp.adminInitiateAuth({
    UserPoolId,
    ClientId,
    AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
    AuthParameters: {
      USERNAME: Username,
      PASSWORD: Password,
    },
  }).promise()

  return {
    statusCode: 200,
    body: JSON.stringify({
      email,
      authResult: authResult.AuthenticationResult
    })
  }
}

async function getUsername(username: string): Promise<string | null> {
  try {
    const resp = await idp.adminGetUser({
      UserPoolId,
      Username: username,
    }).promise()
    console.log(resp)
    return resp.Username
  } catch (err) {
    if (!/UserNotFoundException/.test(err.code)) {
      console.error(err)
    }
  }
  return null
}

async function getKakaoEmail(accessToken: string): Promise<string> {
  const resp = await axios.get('https://kapi.kakao.com/v2/user/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })
  return resp.data.kakao_account.email
}