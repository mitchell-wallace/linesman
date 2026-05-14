export interface Task {
  id: string
  title: string
  description: string
  assignee?: string
  isDone: boolean
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface LapsFile {
  version: number
  tasks: Task[]
}

export type AddPosition = 'head' | 'tail' | 'after'

export interface NewLapInput {
  id?: string
  title: string
  description?: string
  assignee?: string
  isDone?: boolean
  createdAt?: string
  updatedAt?: string
  completedAt?: string | null
}

export interface TaskPatch {
  title?: string
  description?: string
  assignee?: string
  isDone?: boolean
}

export interface ExternalChangeEvent {
  path: string
  file: LapsFile
}
