"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_ROLE_ID, getRole, listRoles } from "./roles";
import { roleIdSchema, type RoleConfig, type RoleId } from "./schemas";

const STORAGE_KEY = "vip.role";

type RoleContextValue = {
  role: RoleConfig;
  choices: { id: RoleId; label: string }[];
  setRoleId: (id: RoleId) => void;
};

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({
  initialRoleId,
  children,
}: {
  initialRoleId?: RoleId;
  children: ReactNode;
}) {
  const [roleId, setRoleIdState] = useState<RoleId>(initialRoleId ?? DEFAULT_ROLE_ID);

  useEffect(() => {
    if (initialRoleId) return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const parsed = roleIdSchema.safeParse(stored);
    if (parsed.success) setRoleIdState(parsed.data);
  }, [initialRoleId]);

  const value = useMemo<RoleContextValue>(() => {
    return {
      role: getRole(roleId),
      choices: listRoles().map((role) => ({ id: role.id, label: role.label })),
      setRoleId: (id) => {
        setRoleIdState(id);
        window.localStorage.setItem(STORAGE_KEY, id);
      },
    };
  }, [roleId]);

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole(): RoleContextValue {
  const value = useContext(RoleContext);
  if (!value) throw new Error("useRole must be used inside RoleProvider");
  return value;
}
