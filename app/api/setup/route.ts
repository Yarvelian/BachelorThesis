import { createClient } from '@supabase/supabase-js'
import { OpenAIEmbeddings } from '@langchain/openai'
import { SupabaseVectorStore } from 'langchain/vectorstores/supabase'
import { PDFLoader } from 'langchain/document_loaders/fs/pdf'
import fs from 'fs'
import { CSVLoader } from 'langchain/dist/document_loaders/fs/csv'
import { TextLoader } from 'langchain/dist/document_loaders/fs/text'
import {
  JSONLinesLoader,
  JSONLoader
} from 'langchain/dist/document_loaders/fs/json'
import { DirectoryLoader } from 'langchain/dist/document_loaders/fs/directory'
import * as path from 'path'
import {
  RecursiveCharacterTextSplitter,
  SupportedTextSplitterLanguage
} from 'langchain/text_splitter'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_ANON_KEY

type CodeLanguages = {
  [key: string]: string
}

const codeLanguages: CodeLanguages = {
  '.cpp': 'cpp',
  '.go': 'go',
  '.java': 'java',
  '.js': 'js',
  '.php': 'php',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.swift': 'swift'
}

// @ts-ignore
export async function POST(req, res) {
  const tempDir = './temp'
  const formData = await req.formData()

  const projectDocs = formData.getAll('projectDocs')
  const projectDescription = formData.get('projectDescription')
  console.log(formData.getAll('projectDocs'), 'req.projectDocs')
  console.log(formData.get('projectDescription'), 'req.projectDescription')

  const client = createClient(supabaseUrl!, supabaseKey!)

  fs.mkdir(tempDir, { recursive: true }, err => {
    if (err) {
      console.error(err.message)
      return
    }
    console.log('tempDir created successfully')
  })

  for (const file of projectDocs) {
    if (file instanceof File) {
      const filePath = path.join(tempDir, file.name)
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      fs.writeFile(filePath, buffer, err => {
        if (err) console.log(err)
        else {
          console.log('File written successfully\n')
        }
      })
    }
  }

  const loader = new DirectoryLoader('temp/', {
    '.json': path => new JSONLoader(path, '/texts'),
    '.jsonl': path => new JSONLinesLoader(path, '/html'),
    '.txt': path => new TextLoader(path),
    '.csv': path => new CSVLoader(path, 'text'),
    '.pdf': path => new PDFLoader(path)
  })

  try {
    const docs = await loader.load()

    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200
    })

    const splits = await textSplitter.splitDocuments(docs)

    for (const ext in codeLanguages) {
      const codeSplitter = RecursiveCharacterTextSplitter.fromLanguage(
        codeLanguages[ext],
        {
          chunkSize: 2000,
          chunkOverlap: 200
        }
      )
      const codeDocs = await new DirectoryLoader('temp/', {
        [ext]: path => new TextLoader(path)
      }).load()
      const codeSplits = await codeSplitter.splitDocuments(codeDocs)
      splits.push(...codeSplits)
    }

    fs.rm('./temp/', { recursive: true, force: true }, err => {
      if (err) {
        console.error(err.message)
        return
      }
    })

    const vectorStore = await SupabaseVectorStore.fromDocuments(
      splits,
      new OpenAIEmbeddings(),
      {
        client,
        tableName: 'documents',
        queryName: 'match_documents'
      }
    )
    console.error('Vector store created')

    return new Response(
      JSON.stringify({
        message: 'Files uploaded successfully!'
      }),
      { status: 200 }
    )
  } catch (error) {
    console.error(error)
  }
}
