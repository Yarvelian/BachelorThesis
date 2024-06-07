'use client'

import * as React from 'react'
import { ThemeProvider as NextThemesProvider } from 'next-themes'
import { ThemeProviderProps } from 'next-themes/dist/types'
import { SidebarProvider } from '@/lib/hooks/use-sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PrimeReactProvider } from 'primereact/api'

export function Providers({ children, ...props }: ThemeProviderProps) {
  // @ts-ignore
  return (
    <PrimeReactProvider
      value={{
        unstyled: false
      }}
    >
      <NextThemesProvider {...props}>
        <SidebarProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </SidebarProvider>
      </NextThemesProvider>
    </PrimeReactProvider>
  )
}
