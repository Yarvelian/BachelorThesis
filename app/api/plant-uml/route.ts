import axios from 'axios'
import fs from 'fs'
import { promisify } from 'util'
import plantumlEncoder from 'plantuml-encoder'
import { NextRequest, NextResponse } from 'next/server'

const streamPipeline = promisify(require('stream').pipeline)

export async function POST(req: NextRequest) {
  if (req.method === 'POST') {
    const { plantUMLCode } = await req.json()

    const encoded = plantumlEncoder.encode(plantUMLCode)

    const imageUrl = `http://www.plantuml.com/plantuml/img/${encoded}`

    const imagePath = './diagram.png'

    try {
      const response = await axios({
        url: imageUrl,
        method: 'GET',
        responseType: 'stream'
      })

      await streamPipeline(response.data, fs.createWriteStream(imagePath))

      return new NextResponse(
        JSON.stringify({ path: `/diagrams/diagram.png` }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    } catch (error) {
      console.error('Error downloading or saving the image:', error)
      return new NextResponse(
        JSON.stringify({ error: 'Error processing your request' }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    }
  } else {
    const response = new NextResponse(
      JSON.stringify({ end: `Method ${req.method} Not Allowed` }),
      { status: 405 }
    )
    response.headers.set('Allow', 'POST')
    return response
  }
}
