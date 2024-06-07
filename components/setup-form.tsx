'use client'

import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { FileUpload } from 'primereact/fileupload'
import { useState } from 'react'

const formSchema = z.object({
  projectDescription: z.string().min(10, {
    message: 'Description must be at least 10 characters.'
  }),
  projectDocs: z.instanceof(File).array().optional()
})

// @ts-ignore
export function ProjectSetupForm({ onClose }) {
  const [files, setFiles] = useState([])

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      projectDescription: '',
      projectDocs: undefined
    }
  })

  function onSubmit(values: z.infer<typeof formSchema>) {
    const formData = new FormData()
    formData.append('projectDescription', values.projectDescription)
    console.log(files, 'e.files 222')
    if (files && files.length > 0) {
      for (const file of files) {
        formData.append('projectDocs', file)
      }
    }

    console.log(values.projectDescription, 'values.projectDescription')
    fetch('/api/setup', {
      method: 'POST',
      body: formData
    })
      .then(response => {
        if (response.ok) {
          onClose()
        }
        return response.json()
      })
      .then(data => {
        console.log('Success:', data)
      })
      .catch(error => {
        console.error('Error:', error)
      })
  }
  const onFileSelect = e => {
    console.log(e.files, 'e.files')
    setFiles(e.files)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <FormField
          control={form.control}
          name="projectDescription"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Project Description</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Describe your project here..."
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Provide a detailed description of your project.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="projectDocs"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Project Files</FormLabel>
              <FormControl>
                <FileUpload
                  multiple
                  name="files"
                  accept="*"
                  maxFileSize={100000000}
                  customUpload
                  uploadHandler={onFileSelect}
                />
              </FormControl>
              <FormDescription>
                Upload files related to your project. Supports multiple files.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-center">
          <Button type="submit">Submit</Button>
        </div>
      </form>
    </Form>
  )
}
