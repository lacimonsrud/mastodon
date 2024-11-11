# frozen_string_literal: true

class Trends::Tags < Trends::Base
  PREFIX = 'trending_tags'

  self.default_options = {
    threshold: 5,
    review_threshold: 3,
    max_score_cooldown: 2.days.freeze,
    max_score_halflife: 4.hours.freeze,
    decay_threshold: 1,
  }

  class Query < Trends::Query
    def filtered_for!(account)
      @account = account
      self
    end

    def filtered_for(account)
      clone.filtered_for!(account)
    end

    def to_arel
      scope = Tag.joins(:trend).reorder(language_order_clause.desc, score: :desc)
      scope = scope.merge(TagTrend.allowed) if @allowed
      scope = scope.offset(@offset) if @offset.present?
      scope = scope.limit(@limit) if @limit.present?
      scope
    end

    private

    def language_order_clause
      Arel::Nodes::Case.new.when(TagTrend.arel_table[:language].in(preferred_languages)).then(1).else(0)
    end

    def preferred_languages
      if @account&.chosen_languages.present?
        @account.chosen_languages
      else
        @locale
      end
    end
  end

  def register(status, at_time = Time.now.utc)
    return unless !status.reblog? && status.public_visibility? && !status.account.silenced?

    status.tags.each do |tag|
      add(tag, status.account_id, status.language, at_time) if tag.usable?
    end
  end

  def add(tag, account_id, language, at_time = Time.now.utc)
    # This history is used for display purposes
    tag.history.add(account_id, at_time)

    # This history is used for calculating the score
    tag.history(language).add(account_id, at_time)

    # We need to save the language along with the hashtag so we know which languages to calculate for later
    record_used_id("#{tag.id}:#{language}", at_time)
  end

  def query
    Query.new(key_prefix, klass)
  end

  def refresh(at_time = Time.now.utc)
    # First, recalculate scores for links that were trending previously. We split the queries
    # to avoid having to load all of the IDs into Ruby just to send them back into Postgres
    Tag.where(id: TagTrend.select(:tag_id)).find_in_batches(batch_size: BATCH_SIZE) do |tags|
      calculate_scores(tags, at_time)
    end

    # Then, calculate scores for links that were used today. There are potentially some
    # duplicate items here that we might process one more time, but that should be fine
    Tag.where(id: recently_used_ids(at_time).map { |str| str.split(':').first }.uniq).find_in_batches(batch_size: BATCH_SIZE) do |tags|
      calculate_scores(tags, at_time)
    end

    # Now that all trends have up-to-date scores, and all the ones below the threshold have
    # been removed, we can recalculate their positions
    TagTrend.recalculate_ordered_rank
  end

  def request_review
    score_at_threshold  = TagTrend.allowed.by_rank.ranked_below(options[:review_threshold]).first&.score || 0
    preview_card_trends = TagTrend.not_allowed.includes(:tag)

    preview_card_trends.filter_map do |trend|
      tag = trend.tag

      if trend.score > score_at_threshold && !tag.trendable? && tag.requires_review_notification?
        tag.touch(:requested_review_at)
        tag
      end
    end
  end

  protected

  def key_prefix
    PREFIX
  end

  def klass
    Tag
  end

  private

  def calculate_scores(tags, at_time)
    items = tags.map do |tag|
      expected  = tag.history.get(at_time - 1.day).accounts.to_f
      expected  = 1.0 if expected.zero?
      observed  = tag.history.get(at_time).accounts.to_f
      max_time  = tag.max_score_at
      max_score = tag.max_score
      max_score = 0 if max_time.nil? || max_time < (at_time - options[:max_score_cooldown])

      score = if expected > observed || observed < options[:threshold]
                0
              else
                ((observed - expected)**2) / expected
              end

      if score > max_score
        max_score = score
        max_time  = at_time

        # Not interested in triggering any callbacks for this
        tag.update_columns(max_score: max_score, max_score_at: max_time)
      end

      decaying_score = max_score * (0.5**((at_time.to_f - max_time.to_f) / options[:max_score_halflife].to_f))

      [decaying_score, tag]
    end

    to_insert = items.filter { |(score, _)| score >= options[:decay_threshold] }
    to_delete = items.filter { |(score, _)| score < options[:decay_threshold] }

    TagTrend.upsert_all(to_insert.map { |(score, tag)| { tag_id: tag.id, score: score, languages: [], allowed: tag.trendable? || false } }, unique_by: :tag_id) if to_insert.any?
    TagTrend.where(tag_id: to_delete.map { |(_, tag)| tag.id }).delete_all if to_delete.any?
  end
end
