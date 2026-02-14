'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import type { FriendRequest, UserSearchResult } from '@/lib/types';
import {
  trackFriendSearch,
  trackFriendRequestSent,
  trackFriendRequestAccepted,
  trackFriendRequestRejected,
} from '@/lib/analytics';

interface UseFriendRequestsOptions {
  refreshFriends: () => Promise<void>;
}

export function useFriendRequests({ refreshFriends }: UseFriendRequestsOptions) {
  const { user, loading: authLoading } = useAuth();
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([]);
  const [pendingIncomingCount, setPendingIncomingCount] = useState(0);
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const initialFetchDone = useRef(false);

  const fetchRequests = useCallback(async () => {
    if (!user) return;

    // Fetch incoming pending requests with sender profile
    const { data: incoming } = await supabase
      .from('friend_requests')
      .select('id, sender_id, receiver_id, status, created_at')
      .eq('receiver_id', user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    // Fetch outgoing pending requests with receiver profile
    const { data: outgoing } = await supabase
      .from('friend_requests')
      .select('id, sender_id, receiver_id, status, created_at')
      .eq('sender_id', user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    // Get profiles for all involved users
    const userIds = new Set<string>();
    incoming?.forEach((r) => userIds.add(r.sender_id));
    outgoing?.forEach((r) => userIds.add(r.receiver_id));

    let profileMap = new Map<string, { display_name: string | null; email: string | null; x_handle: string | null }>();
    if (userIds.size > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name, email, x_handle')
        .in('user_id', [...userIds]);

      profileMap = new Map(
        (profiles ?? []).map((p) => [p.user_id, { display_name: p.display_name, email: p.email, x_handle: p.x_handle }])
      );
    }

    const incomingWithProfiles: FriendRequest[] = (incoming ?? []).map((r) => ({
      ...r,
      sender_profile: profileMap.get(r.sender_id),
    }));

    const outgoingWithProfiles: FriendRequest[] = (outgoing ?? []).map((r) => ({
      ...r,
      receiver_profile: profileMap.get(r.receiver_id),
    }));

    setIncomingRequests(incomingWithProfiles);
    setOutgoingRequests(outgoingWithProfiles);
    setPendingIncomingCount(incomingWithProfiles.length);
  }, [user]);

  // Fetch requests on mount
  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setIncomingRequests([]);
      setOutgoingRequests([]);
      setPendingIncomingCount(0);
      initialFetchDone.current = false;
      return;
    }

    if (initialFetchDone.current) return;

    fetchRequests().then(() => {
      initialFetchDone.current = true;
    });
  }, [user, authLoading, fetchRequests]);

  const searchUsers = useCallback(async (query: string) => {
    if (!user || !query.trim()) {
      setSearchResults([]);
      return;
    }

    const trimmed = query.trim();
    let searchType: string;
    let searchQuery: string;

    if (trimmed.includes('@') && trimmed.includes('.')) {
      // Email search
      searchType = 'email';
      searchQuery = trimmed;
    } else if (trimmed.startsWith('@') && !trimmed.includes('.')) {
      // X handle search (strip @)
      searchType = 'x_handle';
      searchQuery = trimmed.slice(1);
    } else {
      // Display name search
      searchType = 'display_name';
      searchQuery = trimmed;
    }

    setSearchLoading(true);
    trackFriendSearch(searchType);

    const { data, error } = await supabase.rpc('search_users', {
      search_query: searchQuery,
      search_type: searchType,
    });

    if (error) {
      console.error('Search failed:', error);
      setSearchResults([]);
    } else {
      setSearchResults((data ?? []) as UserSearchResult[]);
    }

    setSearchLoading(false);
  }, [user]);

  const sendRequest = useCallback(async (receiverId: string) => {
    if (!user) return;

    const { error } = await supabase.rpc('send_friend_request', {
      receiver: receiverId,
    });

    if (error) {
      console.error('Failed to send friend request:', error);
      return;
    }

    trackFriendRequestSent();
    await fetchRequests();
    await refreshFriends();

    // Update search results to reflect the new status
    setSearchResults((prev) =>
      prev.map((r) =>
        r.user_id === receiverId ? { ...r, request_status: 'pending_outgoing' as const } : r
      )
    );
  }, [user, fetchRequests, refreshFriends]);

  const respondToRequest = useCallback(async (requestId: string, accept: boolean) => {
    if (!user) return;

    const { error } = await supabase.rpc('respond_to_friend_request', {
      request_id: requestId,
      accept,
    });

    if (error) {
      console.error('Failed to respond to request:', error);
      return;
    }

    if (accept) {
      trackFriendRequestAccepted();
    } else {
      trackFriendRequestRejected();
    }

    await fetchRequests();
    if (accept) {
      await refreshFriends();
    }
  }, [user, fetchRequests, refreshFriends]);

  const cancelRequest = useCallback(async (requestId: string) => {
    if (!user) return;

    const { error } = await supabase
      .from('friend_requests')
      .delete()
      .eq('id', requestId)
      .eq('sender_id', user.id);

    if (error) {
      console.error('Failed to cancel request:', error);
      return;
    }

    await fetchRequests();
  }, [user, fetchRequests]);

  return {
    incomingRequests,
    outgoingRequests,
    pendingIncomingCount,
    searchResults,
    searchLoading,
    searchUsers,
    sendRequest,
    respondToRequest,
    cancelRequest,
  };
}
