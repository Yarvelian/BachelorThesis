import { clsx, type ClassValue } from 'clsx'
import { customAlphabet } from 'nanoid'
import { twMerge } from 'tailwind-merge'
import plantumlEncoder from 'plantuml-encoder'
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const nanoid = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  7
) // 7-character random string

export async function fetcher<JSON = any>(
  input: RequestInfo,
  init?: RequestInit
): Promise<JSON> {
  const res = await fetch(input, init)

  if (!res.ok) {
    const json = await res.json()
    if (json.error) {
      const error = new Error(json.error) as Error & {
        status: number
      }
      error.status = res.status
      throw error
    } else {
      throw new Error('An unexpected error occurred')
    }
  }

  return res.json()
}

export function formatDate(input: string | number | Date): string {
  const date = new Date(input)
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })
}

export function extractPlantUMLCode(fullResponse: string): string | null {
  const markdownRegex = /```plantuml([\s\S]*?)```/g
  const umlCodeMatch = markdownRegex.exec(fullResponse)

  if (umlCodeMatch && umlCodeMatch[1]) {
    const umlCodeBlock = umlCodeMatch[1]
    const umlCodeContentMatch = /@startuml([\s\S]*?)@enduml/g.exec(umlCodeBlock)

    if (umlCodeContentMatch && umlCodeContentMatch[1]) {
      return `@startuml${umlCodeContentMatch[1]}@enduml`.trim()
    }
  }

  return null
}

export function generatePlantUMLImageUrl(plantUMLCode: string): string {
  const encoded = plantumlEncoder.encode(plantUMLCode)
  const imageUrl = `http://www.plantuml.com/plantuml/img/${encoded}`
  return imageUrl
}
