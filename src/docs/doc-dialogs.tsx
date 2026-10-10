import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@opencroft/client/ui'

export function DeleteDocDialog({
  target,
  onCancel,
  onConfirm,
}: {
  /** The page asked about; null while no question is open. */
  target: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={target !== null} onOpenChange={(o: boolean) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete document?</AlertDialogTitle>
          <AlertDialogDescription>
            {target && (
              <>
                This will permanently delete <span className='font-mono'>{target}</span>.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant='destructive' onClick={onConfirm}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
