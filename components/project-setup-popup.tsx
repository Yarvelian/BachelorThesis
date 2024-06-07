'use client'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { ProjectSetupForm } from '@/components/setup-form'

// @ts-ignore
export function DialogSetupProject({ isOpen, onOpen }) {
  const handleClose = () => {
    onOpen(false)
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={onOpen}>
      <AlertDialogContent onEscapeKeyDown={event => event.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Setup Project</AlertDialogTitle>
          <AlertDialogDescription>
            Please give some information about your project.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ProjectSetupForm onClose={handleClose} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
