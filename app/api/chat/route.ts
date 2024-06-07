import { NextRequest } from 'next/server'
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai'
import {
  BytesOutputParser,
  StringOutputParser
} from 'langchain/schema/output_parser'
import { PromptTemplate } from 'langchain/prompts'
import { kv } from '@vercel/kv'
import { auth } from '@/auth'
import {
  extractPlantUMLCode,
  generatePlantUMLImageUrl,
  nanoid
} from '@/lib/utils'
import { Message as VercelChatMessage, StreamingTextResponse } from 'ai'
import { SupabaseVectorStore } from 'langchain/vectorstores/supabase'
import { createClient } from '@supabase/supabase-js'
import { createStuffDocumentsChain } from 'langchain/dist/chains/combine_documents'
import { awaitAllCallbacks, LangChainTracer } from 'langchain/callbacks'
import { Client } from 'langsmith'

export const runtime = 'edge'
const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_ANON_KEY

const formatMessage = (message: VercelChatMessage) => {
  return `${message.role}: ${message.content}`
}

export async function POST(req: NextRequest) {
  const json = await req.json()
  const { messages } = json
  const userId = (await auth())?.user.id

  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  const callbacks = [
    new LangChainTracer({
      projectName: 'default',
      client: new Client({
        apiUrl: 'https://api.smith.langchain.com',
        apiKey: process.env.LANGCHAIN_API_KEY
      })
    })
  ]

  const currentMessageContent = messages[messages.length - 1].content

  const formattedPreviousMessages = messages.map(formatMessage)

  const typeOfRequest = await determineTypeOfRequest(
    formattedPreviousMessages,
    currentMessageContent
  )

  let promptTemplate: string

  switch (typeOfRequest) {
    case 'clarification':
      promptTemplate = getClarificationPromptTemplate()
      break
    case 'diagram':
      promptTemplate = getDiagramPromptTemplate()
      break
    default:
      promptTemplate = getGeneralPromptTemplate()
  }

  const vectorStore = await SupabaseVectorStore.fromExistingIndex(
    new OpenAIEmbeddings(),
    {
      client: createClient(supabaseUrl!, supabaseKey!),
      tableName: 'documents',
      queryName: 'match_documents'
    }
  )

  const retriever = vectorStore.asRetriever({
    searchType: 'mmr',
    searchKwargs: { fetchK: 5 }
  })
  const retrievedDocs = await retriever.getRelevantDocuments(
    currentMessageContent
  )

  const model = new ChatOpenAI({
    temperature: 0.7,
    streaming: false,
    modelName: 'gpt-4-turbo'
  })
  const prompt = PromptTemplate.fromTemplate(promptTemplate)
  const ragChain = await createStuffDocumentsChain({
    llm: model,
    prompt: prompt,
    outputParser: new StringOutputParser()
  })

  let fullResponse = await ragChain.invoke(
    {
      chat_history: formattedPreviousMessages.join('\n'),
      input: currentMessageContent,
      context: retrievedDocs
    },
    { callbacks }
  )

  if (typeOfRequest === 'diagram') {
    if (fullResponse.includes('PlantUML code:')) {
      const extractedCode = extractPlantUMLCode(fullResponse)
      if (extractedCode) {
        const highlightPrompt = PromptTemplate.fromTemplate(
          getHighlightPromptTemplate()
        )
        const highlightModel = new ChatOpenAI({
          temperature: 0.7,
          streaming: false,
          modelName: 'gpt-4o'
        })
        const highlightChain = highlightPrompt
          .pipe(highlightModel)
          .pipe(new StringOutputParser())

        let highlightedCodeResponse = await highlightChain.invoke(
          {
            diagram: extractedCode,
            chat_history: formattedPreviousMessages.join('\n'),
            input: currentMessageContent
          },
          { callbacks }
        )

        const verificationPrompt = PromptTemplate.fromTemplate(
          getVerificationPromptTemplate()
        )
        const verificationModel = new ChatOpenAI({
          temperature: 0.7,
          streaming: false,
          modelName: 'gpt-4o'
        })
        const verificationChain = verificationPrompt
          .pipe(verificationModel)
          .pipe(new StringOutputParser())

        let verifiedCodeResponse = await verificationChain.invoke(
          {
            diagram: highlightedCodeResponse,
            input: currentMessageContent
          },
          { callbacks }
        )

        const finalExplanationPrompt = PromptTemplate.fromTemplate(
          getFinalAnswerPromptTemplate()
        )
        const finalExplanationChain = await createStuffDocumentsChain({
          llm: model,
          prompt: finalExplanationPrompt,
          outputParser: new StringOutputParser()
        })
        const extractedDiagram = extractPlantUMLCode(verifiedCodeResponse)
        if (extractedDiagram) {
          fullResponse = await finalExplanationChain.invoke(
            {
              diagram: extractedDiagram,
              chat_history: formattedPreviousMessages.join('\n'),
              input: currentMessageContent,
              context: retrievedDocs
            },
            { callbacks }
          )

          const imageUrl = generatePlantUMLImageUrl(extractedDiagram)
          fullResponse += `\n\n![PlantUML Diagram](${imageUrl})`
        }
      }
    }
  }

  fullResponse += `[Evaluation Response: ${typeOfRequest}]`

  const title = messages[0].content.substring(0, 100)
  const id = json.id ?? nanoid()
  const createdAt = Date.now()
  const path = `/chat/${id}`
  const payload = {
    id,
    title,
    userId,
    createdAt,
    path,
    messages: [
      ...messages,
      {
        content: fullResponse,
        role: 'assistant'
      }
    ]
  }

  await kv.hmset(`chat:${id}`, payload)
  await kv.zadd(`user:chat:${userId}`, {
    score: createdAt,
    member: `chat:${id}`
  })

  return new StreamingTextResponse(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(fullResponse))
        controller.close()
      }
    })
  )
}

async function determineTypeOfRequest(chatHistory: any, userInput: any) {
  const TEMPLATE_DETERMINE_TYPE = `
  Based on the current conversation, classify the type of the user request into one of the following categories:
  - clarification
  - diagram
  - general
  
  Answer with only one of the following words: clarification, diagram, general.
   
  Current conversation:
  {chat_history}

  User Input: {input}
  Type:`

  const determineTypePrompt = PromptTemplate.fromTemplate(
    TEMPLATE_DETERMINE_TYPE
  )
  const determineTypeModel = new ChatOpenAI({
    temperature: 0.7,
    streaming: false,
    modelName: 'gpt-4o'
  })
  const determineTypeChain = determineTypePrompt
    .pipe(determineTypeModel)
    .pipe(new StringOutputParser())

  const typeResponse = await determineTypeChain.invoke({
    chat_history: chatHistory.join('\n'),
    input: userInput
  })

  return typeResponse.trim()
}

function getClarificationPromptTemplate() {
  return `
  As an AI assistant, provide clarification to the user based on the context of the current conversation. Ensure to ask any necessary questions to gather additional information needed for further assistance.

  Current conversation:
  {chat_history}
  
  Also you can use the following pieces of retrieved information to answer the question:
  {context}

  User Input: {input}
  Clarification Response:`
}

function getDiagramPromptTemplate() {
  return `
 As a dedicated software modeling assistant, your expertise lies in crafting detailed and accurate PlantUML diagrams that meet user specifications and incorporate best practices in software design. Your objective is to construct high-quality diagrams based on user definitions and requirements, adhering to the principles of flexible and scalable software architecture through the strategic use of design patterns.

Here's how you should operate:

1. Evaluate the Request:
   - Upon receiving a request, evaluate the provided details to determine if the application of specific design patterns (also relationships such as association, aggregation, or inheritance) could enhance the architecture's flexibility and scalability. If any details are unclear or additional information is needed, proactively seek clarification by posing specific questions.

2. Generate the Diagram:
   - With a comprehensive understanding of the user's needs, proceed to generate the PlantUML diagram. Ensure that the implementation of the identified design patterns is clearly reflected in the design.

3. Output:
   - Conclude your response with the PlantUML code only. Do not include explanations or additional text. Clearly demarcate this section by stating "PlantUML code:" followed by the diagram's syntax, formatted in markdown with header \`\`\`plantuml.

  Current conversation:
  {chat_history}
  
  Also you can use the following pieces of retrieved information to answer the question:
  {context} 
  
  Input: {input}
  AI:`
}

function getVerificationPromptTemplate() {
  return `
  As a dedicated software modeling assistant, your expertise lies in validating and ensuring the accuracy of PlantUML diagrams. 
  Your objective is to verify the syntax correctness and logical consistency of the provided PlantUML diagram code. 
  This includes checking for syntactic errors, ensuring there are no logical issues such as duplicated relationships or disconnected patterns, and validating the correct and meaningful integration of design patterns.
  
Here's how you should operate:

1. Syntax Validation:
   - Check the provided PlantUML code for any syntax errors. Ensure that the code is correctly formatted and follows the PlantUML syntax rules.

2. Logical Consistency:
   - Verify the diagram for logical consistency. This includes checking for duplicated relationships, ensuring that patterns are correctly and meaningfully integrated with the relevant classes, and confirming that all parts of the diagram are interconnected appropriately.

3. Pattern Validation:
   - Ensure that the design patterns specified by the user are correctly applied. For instance, if a pattern is to be integrated between certain classes, ensure that it is logically and visually connected to those classes.

4. Output:
   - If any errors or inconsistencies are found, correct them and return the updated PlantUML code.
   - If the provided diagram is already correct, return the original PlantUML code.
   - Do not include any explanations or additional text. The output should only contain the PlantUML code enclosed in @startuml and @enduml.


By following this structured approach, you will ensure that the PlantUML diagrams are both syntactically correct and logically consistent, providing users with reliable and high-quality diagrams.

  PlantUML Code:
  {diagram}

  Verified PlantUML Code:`
}

function getFinalAnswerPromptTemplate() {
  return `As a dedicated software modeling assistant, your expertise lies in providing detailed explanations and contextual information for PlantUML diagrams that meet user specifications and incorporate best practices in software design. Your objective is to generate comprehensive explanations based on the user’s initial prompt and the generated PlantUML diagram code. This includes describing the design choices, explaining the use of design patterns, and providing insights into the diagram’s structure.

Here's how you should operate:

1. **Analyze User Prompt**:
   - Review the initial prompt provided by the user to understand the requirements and context for the PlantUML diagram.

2. **Explain Diagram Elements**:
   - Describe each element of the diagram, including classes, relationships, and any applied design patterns (also relationships such as association, aggregation, or inheritance).
   - Explain why specific design patterns were used and how they contribute to the overall architecture’s flexibility and scalability.

3. **Highlight Key Features**:
   - Identify and elaborate on the key features and components of the diagram, emphasizing how they address the user’s requirements.
   - Discuss any notable interactions or relationships between the elements.

4. **Provide Contextual Information**:
   - Include any additional insights or considerations relevant to the diagram, such as potential improvements, scalability considerations, or best practices in software design.

5. **Output**:
   - Provide a comprehensive explanation followed by the given PlantUML code that you got. The PlantUML code should be included exactly as received. Clearly demarcate this section by stating "PlantUML code:" followed by the diagram's syntax, formatted in markdown.
   - The explanation should be clear, informative, and relevant to the user’s initial prompt.
   
    Also you can use the following pieces of retrieved information to answer the question:
    {context} 
    
    Current conversation (Chat history):
    {chat_history}
  
    Input: {input}
    
    PlantUML Code:
    {diagram}
   
    AI:`
}

function getGeneralPromptTemplate() {
  return `
  As an AI assistant, respond to the user's general inquiries based on the context of the current conversation.

  Current conversation:
  {chat_history}
  
  Also you can use the following pieces of retrieved information to answer the question:
  {context} 

  User Input: {input}
  AI:`
}

function getHighlightPromptTemplate() {
  return `As a dedicated software modeling assistant, your task is to determine whether the provided PlantUML diagram is new or if it is an update to a previously discussed diagram. Based on this determination, you should highlight new additions or modifications in green if it is an update, or return the diagram as-is if it is new.

Here's how you should operate:

1. Analyze Chat History:
   - Review the chat history to determine if the provided PlantUML diagram code has appeared before. 
   - If the diagram has not been seen before, it is considered new.
   - If the diagram has been seen before and now includes new elements or modifications, it is considered an update.

2. Highlight New Additions** (if applicable):
   - If the diagram is an update, identify any new classes, relationships, or other elements. Use the following example of PlantUML syntax to set the background color for new elements:
     @startuml
      skinparam class {{{{
        BackgroundColor<<New>> LightGreen
      }}}}
      class User {{{{
        +String name
        +String email
        +void login()
      }}}}  
        /' Below example of where to insert a keyword <<New Addition>> when defining a class that implements another class! ' /
        class Employee <<New Addition>> implements User {{{{
        +String role
        }}}}
      
      @enduml
   - Apply this highlighting to the new elements in the provided diagram code.

3. Output:
   - If the diagram is new, return the provided PlantUML code exactly as received.
   - If the diagram is an update, return the updated PlantUML code with new elements highlighted.

  PlantUML Code:
  {diagram}
  
  Current conversation:
  {chat_history}
 
  Input: {input}
  AI:`
}
