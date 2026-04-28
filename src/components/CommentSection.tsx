'use client';

import { useState } from 'react';
import { Send, Trash2, MessageCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useEventComments } from '@/hooks/useEventComments';
import { timeAgo } from '@/lib/time-parse';
import { getDisplayName } from '@/lib/user-display';
import UserAvatar from './UserAvatar';
import { trackCommentExpand, trackCommentAdd, trackCommentDelete, trackCommentVisibilityToggle } from '@/lib/analytics';

interface CommentSectionProps {
  eventId: string;
  commentCount?: number;
}

export function CommentSection({ eventId, commentCount = 0 }: CommentSectionProps) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const { comments, loading, addComment, deleteComment } = useEventComments(
    expanded ? eventId : null
  );
  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'friends'>('public');

  const handleSubmit = async () => {
    if (!text.trim()) return;
    await addComment(text, visibility);
    trackCommentAdd(eventId, visibility);
    setText('');
  };

  if (!expanded) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          trackCommentExpand(eventId);
          setExpanded(true);
        }}
        className="flex items-center gap-1.5 text-xs text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)] transition-colors cursor-pointer"
      >
        <MessageCircle className="w-3.5 h-3.5" />
        {commentCount > 0 ? `${commentCount} comment${commentCount !== 1 ? 's' : ''}` : 'Comments'}
      </button>
    );
  }

  return (
    <div className="mt-2 border-t border-[var(--theme-border-primary)]/50 pt-2" onClick={(e) => e.stopPropagation()}>
      {/* Header */}
      <button
        onClick={() => setExpanded(false)}
        className="flex items-center gap-1.5 text-xs text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] transition-colors cursor-pointer mb-2"
      >
        <MessageCircle className="w-3.5 h-3.5" />
        <span>
          {comments.length > 0 ? `${comments.length} comment${comments.length !== 1 ? 's' : ''}` : 'Comments'}
        </span>
      </button>

      {/* Comments list */}
      {loading ? (
        <div className="text-xs text-[var(--theme-text-muted)] py-2">Loading...</div>
      ) : (
        <div className="max-h-[200px] overflow-y-auto space-y-2 mb-2">
          {comments.map((comment) => {
            const name = getDisplayName(comment);

            return (
              <div key={comment.id} className="flex gap-2 group/comment">
                <UserAvatar size="xs" avatarUrl={comment.avatar_url} xHandle={comment.x_handle} displayName={comment.display_name} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-[var(--theme-text-secondary)]">{name}</span>
                    <span className="text-[10px] text-[var(--theme-text-faint)]">{timeAgo(comment.created_at)}</span>
                    {comment.visibility === 'friends' && (
                      <span className="text-[9px] rounded px-1" style={{ color: 'var(--friend-blue)', opacity: 0.6, borderWidth: '1px', borderColor: 'color-mix(in srgb, var(--friend-blue) 30%, transparent)' }}>friends</span>
                    )}
                    {user && comment.user_id === user.id && (
                      <button
                        onClick={() => { trackCommentDelete(eventId); deleteComment(comment.id); }}
                        className="opacity-0 group-hover/comment:opacity-100 p-0.5 text-[var(--theme-text-faint)] hover:text-red-400 transition-all cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-[var(--theme-text-secondary)] leading-relaxed break-words">{comment.text}</p>
                </div>
              </div>
            );
          })}
          {comments.length === 0 && !loading && (
            <p className="text-xs text-[var(--theme-text-faint)] py-1">No comments yet</p>
          )}
        </div>
      )}

      {/* Input */}
      {user && (
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-1 bg-[var(--theme-bg-tertiary)]/50 border border-[var(--theme-border-primary)] rounded-lg px-2 py-1.5">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="Add a comment..."
              maxLength={500}
              className="flex-1 bg-transparent text-xs text-[var(--theme-text-primary)] placeholder-slate-500 outline-none min-w-0"
            />
            <button
              onClick={() => { const next = visibility === 'public' ? 'friends' : 'public'; trackCommentVisibilityToggle(next); setVisibility(next); }}
              className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 cursor-pointer transition-colors ${
                visibility === 'friends'
                  ? ''
                  : 'border-[var(--theme-border-primary)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]'
              }`}
              style={visibility === 'friends' ? { borderColor: 'color-mix(in srgb, var(--friend-blue) 40%, transparent)', color: 'var(--friend-blue)', backgroundColor: 'color-mix(in srgb, var(--friend-blue) 10%, transparent)' } : undefined}
              title={visibility === 'public' ? 'Visible to everyone' : 'Visible to friends only'}
            >
              {visibility === 'public' ? 'public' : 'friends'}
            </button>
          </div>
          <button
            onClick={handleSubmit}
            disabled={!text.trim()}
            className="p-1.5 rounded-lg bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] disabled:bg-[var(--theme-bg-tertiary)] disabled:text-[var(--theme-text-muted)] text-[var(--theme-accent-text)] transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
