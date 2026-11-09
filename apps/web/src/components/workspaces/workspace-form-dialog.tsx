"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { LoaderCircle, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { FormError } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, errorMessage } from "@/lib/api/client";
import { workspaceDescriptionSchema, workspaceNameSchema } from "@/lib/validations/workspaces";

const formSchema = z.object({ name: workspaceNameSchema, description: workspaceDescriptionSchema });
type FormValues = z.infer<typeof formSchema>;

type Props =
  | { mode: "create"; organizationId: string; defaultOpen?: boolean }
  | { mode: "edit"; workspace: { id: string; name: string; description: string | null } };

export function WorkspaceFormDialog(props: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(props.mode === "create" && Boolean(props.defaultOpen));
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: props.mode === "edit"
      ? { name: props.workspace.name, description: props.workspace.description ?? "" }
      : { name: "", description: "" },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => props.mode === "create"
      ? apiFetch<{ id: string }>("/api/workspaces", { method: "POST", json: { organizationId: props.organizationId, ...values } })
      : apiFetch<{ id: string }>(`/api/workspaces/${props.workspace.id}`, { method: "PATCH", json: values }),
    onSuccess: ({ data }) => {
      setOpen(false);
      if (props.mode === "create") {
        form.reset();
        router.push(`/workspaces/${data.id}`);
      }
      router.refresh();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) mutation.reset(); }}>
      <DialogTrigger render={<Button variant={props.mode === "create" ? "default" : "outline"} />}>
        {props.mode === "create" ? <><Plus />New workspace</> : <><Pencil />Edit</>}
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{props.mode === "create" ? "Create workspace" : "Edit workspace"}</DialogTitle>
            <DialogDescription>Workspaces hold documents, agent runs, and reports for one area of work.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="workspace-name">Name</Label>
            <Input id="workspace-name" autoFocus aria-invalid={Boolean(form.formState.errors.name)} {...form.register("name")} />
            <FormError message={form.formState.errors.name?.message} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="workspace-description">Description <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea id="workspace-description" rows={3} {...form.register("description")} />
            <FormError message={form.formState.errors.description?.message} />
          </div>
          <FormError message={mutation.error ? errorMessage(mutation.error) : null} />
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>{mutation.isPending && <LoaderCircle className="animate-spin" />}{props.mode === "create" ? "Create workspace" : "Save changes"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
