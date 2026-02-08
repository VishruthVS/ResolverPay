"use client";

import { Globe, PlusCircle, Eye, Zap } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const navItems = [
  { title: "ENS Resolver", url: "/ens", icon: Globe },
  { title: "Create Intent", url: "/create", icon: PlusCircle },
  { title: "View Intents", url: "/view", icon: Eye },
  { title: "Execute Intent", url: "/execute", icon: Zap },
];

export function AppSidebar() {
  return (
    <Sidebar className="w-64 border-r border-border">
      <SidebarContent>
        <div className="px-6 py-6">
          <h1 className="text-xl font-bold font-mono tracking-tight text-primary">
            ⚡ ResolverPay
          </h1>
          <p className="text-xs text-muted-foreground mt-1">Intent-based settlement</p>
        </div>
        <SidebarGroup>
          <SidebarGroupLabel className="text-muted-foreground text-xs uppercase tracking-widest px-6">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      href={item.url}
                      end
                      className="flex items-center gap-3 px-6 py-2.5 text-sm transition-colors hover:bg-secondary hover:text-primary rounded-none"
                      activeClassName="bg-secondary text-primary border-l-2 border-primary"
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
