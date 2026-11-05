"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { DashboardShell } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const examples = [
  { name: "Sample completed session", status: "Completed", duration: "18m 42s" },
  { name: "Sample active session", status: "In progress", duration: "6m 12s" },
  { name: "Sample invited candidate", status: "Not started", duration: "—" },
];

export function BackofficePreview() {
  const { setTheme } = useTheme();
  const [search, setSearch] = useState("");
  const [state, setState] = useState("populated");
  const [selected, setSelected] = useState<string | null>(null);
  const rows = state === "empty" ? [] : examples.filter(row => row.name.toLowerCase().includes(search.toLowerCase()));
  return <DashboardShell>
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 text-sm">
        <p className="mr-auto text-muted-foreground">Design preview · illustrative records only. Navigation opens the real, authenticated app.</p>
        <Button variant="outline" size="sm" onClick={() => setTheme("light")}>Light</Button>
        <Button variant="outline" size="sm" onClick={() => setTheme("dark")}>Dark</Button>
        <label className="flex items-center gap-2">State<select className="rounded-md border bg-background p-2" value={state} onChange={e => setState(e.target.value)}><option value="populated">Populated</option><option value="empty">Empty</option><option value="error">Error</option></select></label>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-semibold tracking-tight">Interview sessions</h1><p className="mt-1 text-muted-foreground">Review progress, responses, and completed interviews.</p></div>
        <Button onClick={() => setSelected("Interview settings")}>Preview settings</Button>
      </div>
      {state === "error" ? <div role="alert" className="rounded-lg border border-destructive p-5"><h2 className="font-semibold">Sessions could not be loaded</h2><p className="my-2 text-sm text-muted-foreground">Preview error state. Try loading the sample records again.</p><Button variant="outline" onClick={() => setState("populated")}>Try again</Button></div> :
      <Card><CardHeader><CardTitle>Customer Support Specialist</CardTitle><p className="text-sm text-muted-foreground">Voice and video · 20 minute time limit</p></CardHeader><CardContent>
        <Label htmlFor="preview-search">Search sessions</Label><Input id="preview-search" className="mb-5 mt-2 max-w-sm" placeholder="Search sample sessions" value={search} onChange={e => setSearch(e.target.value)} />
        <Table><TableHeader><TableRow><TableHead>Participant</TableHead><TableHead>Status</TableHead><TableHead>Duration</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
          <TableBody>{rows.map(row => <TableRow key={row.name}><TableCell className="font-medium">{row.name}</TableCell><TableCell><Badge variant="secondary" className={row.status === "Completed" ? "text-secondary-600" : row.status === "In progress" ? "text-amber-600" : undefined}>{row.status}</Badge></TableCell><TableCell>{row.duration}</TableCell><TableCell><Button variant="ghost" size="sm" onClick={() => setSelected(row.name)}>View sample</Button></TableCell></TableRow>)}{!rows.length && <TableRow><TableCell colSpan={4} className="py-12 text-center text-muted-foreground">{search ? "No sessions match your search." : "No sessions yet. Invited candidates will appear here."}</TableCell></TableRow>}</TableBody>
        </Table>
      </CardContent></Card>}
      <Dialog open={!!selected} onOpenChange={open => !open && setSelected(null)}><DialogContent><DialogHeader><DialogTitle>{selected}</DialogTitle><DialogDescription>Preview of shared form and dialog styling. These sample values are not saved.</DialogDescription></DialogHeader><Label htmlFor="sample-title">Interview title</Label><Input id="sample-title" defaultValue="Customer Support Specialist" /><Label htmlFor="sample-limit">Time limit (minutes)</Label><Input id="sample-limit" type="number" defaultValue="20" /><Button onClick={() => setSelected(null)}>Done</Button></DialogContent></Dialog>
    </div>
  </DashboardShell>;
}
