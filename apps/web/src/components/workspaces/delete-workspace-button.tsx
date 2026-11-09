"use client";

import { useMutation } from "@tanstack/react-query";
import { LoaderCircle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/common/states";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, errorMessage } from "@/lib/api/client";

export function DeleteWorkspaceButton({ workspace }: { workspace: { id: string; name: string } }) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const mutation = useMutation({
    mutationFn: () => apiFetch(`/api/workspaces/${workspace.id}`, { method: "DELETE" }),
    onSuccess: () => {
      router.push("/workspaces");
      router.refresh();
    },
  });
  return (
    <AlertDialog onOpenChange={(open) => { if (!open) { setConfirmation(""); mutation.reset(); } }}>
      <AlertDialogTrigger render={<Button variant="destructive" />}><Trash2 />Delete</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{workspace.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the workspace with all of its documents, agent runs, and reports. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-1.5">
          <label htmlFor="confirm-workspace" className="text-sm">Type the workspace name to confirm</label>
          <Input id="confirm-workspace" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
        </div>
        <FormError message={mutation.error ? errorMessage(mutation.error) : null} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={confirmation !== workspace.name || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending && <LoaderCircle className="animate-spin" />}Delete workspace
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
