import { useEffect, useState, useCallback } from 'react';

import { FormattedMessage, useIntl, defineMessages } from 'react-intl';

import { isFulfilled } from '@reduxjs/toolkit';

import CloseIcon from '@/material-icons/400-24px/close.svg?react';
import ListAltIcon from '@/material-icons/400-24px/list_alt.svg?react';
import { fetchLists } from 'mastodon/actions/lists';
import { createList } from 'mastodon/actions/lists_typed';
import { apiRequestGet, apiRequestPost, apiRequestDelete } from 'mastodon/api';
import type { ApiListJSON } from 'mastodon/api_types/lists';
import { Button } from 'mastodon/components/button';
import { CheckBox } from 'mastodon/components/check_box';
import { Icon } from 'mastodon/components/icon';
import { IconButton } from 'mastodon/components/icon_button';
import { getOrderedLists } from 'mastodon/selectors/lists';
import { useAppDispatch, useAppSelector } from 'mastodon/store';

const messages = defineMessages({
  newList: {
    id: 'lists.new_list_name',
    defaultMessage: 'New list name',
  },
  createList: {
    id: 'lists.create',
    defaultMessage: 'Create',
  },
  close: {
    id: 'lightbox.close',
    defaultMessage: 'Close',
  },
});

const ListItem: React.FC<{
  id: string;
  title: string;
  checked: boolean;
  onChange: (id: string, checked: boolean) => void;
}> = ({ id, title, checked, onChange }) => {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(id, e.target.checked);
    },
    [id, onChange],
  );

  return (
    // eslint-disable-next-line jsx-a11y/label-has-associated-control
    <label className='lists__item'>
      <div className='lists__item__title'>
        <Icon id='list-ul' icon={ListAltIcon} />
        <span>{title}</span>
      </div>

      <CheckBox value={id} checked={checked} onChange={handleChange} />
    </label>
  );
};

const NewListItem: React.FC<{
  onCreate: (list: ApiListJSON) => void;
}> = ({ onCreate }) => {
  const intl = useIntl();
  const dispatch = useAppDispatch();
  const [title, setTitle] = useState('');

  const handleChange = useCallback(
    ({ target: { value } }: React.ChangeEvent<HTMLInputElement>) => {
      setTitle(value);
    },
    [setTitle],
  );

  const handleSubmit = useCallback(async () => {
    const result = await dispatch(createList({ title }));

    if (isFulfilled(result)) {
      onCreate(result.payload);
      setTitle('');
    }
  }, [setTitle, dispatch, onCreate, title]);

  return (
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    <form className='lists__item' onSubmit={handleSubmit}>
      <label className='lists__item__title'>
        <Icon id='list-ul' icon={ListAltIcon} />

        <input
          type='text'
          value={title}
          onChange={handleChange}
          maxLength={30}
          placeholder={intl.formatMessage(messages.newList)}
        />
      </label>

      <Button
        text={intl.formatMessage(messages.createList)}
        /* eslint-disable-next-line @typescript-eslint/no-misused-promises */
        onClick={handleSubmit}
      />
    </form>
  );
};

const ListAdder: React.FC<{
  accountId: string;
  onClose: () => void;
}> = ({ accountId, onClose }) => {
  const intl = useIntl();
  const dispatch = useAppDispatch();
  const account = useAppSelector((state) => state.accounts.get(accountId));
  const lists = useAppSelector((state) => getOrderedLists(state));
  const [listIds, setListIds] = useState<string[]>([]);

  useEffect(() => {
    dispatch(fetchLists());

    apiRequestGet<ApiListJSON[]>(`v1/accounts/${accountId}/lists`)
      .then((data) => {
        setListIds(data.map((l) => l.id));
        return '';
      })
      .catch(() => {
        // Nothing
      });
  }, [dispatch, setListIds, accountId]);

  const handleToggle = useCallback(
    (listId: string, checked: boolean) => {
      if (checked) {
        setListIds((currentListIds) => [listId, ...currentListIds]);

        apiRequestPost(`v1/lists/${listId}/accounts`, {
          account_ids: [accountId],
        })
          .then(() => {
            return '';
          })
          .catch(() => {
            setListIds((currentListIds) =>
              currentListIds.filter((id) => id !== listId),
            );
          });
      } else {
        setListIds((currentListIds) =>
          currentListIds.filter((id) => id !== listId),
        );

        apiRequestDelete(`v1/lists/${listId}/accounts`, {
          account_ids: [accountId],
        })
          .then(() => {
            return '';
          })
          .catch(() => {
            setListIds((currentListIds) => [listId, ...currentListIds]);
          });
      }
    },
    [setListIds, accountId],
  );

  const handleCreate = useCallback(
    (list: ApiListJSON) => {
      setListIds((currentListIds) => [list.id, ...currentListIds]);

      apiRequestPost(`v1/lists/${list.id}/accounts`, {
        account_ids: [accountId],
      })
        .then(() => {
          return '';
        })
        .catch(() => {
          setListIds((currentListIds) =>
            currentListIds.filter((id) => id !== list.id),
          );
        });
    },
    [setListIds, accountId],
  );

  return (
    <div className='modal-root__modal dialog-modal'>
      <div className='dialog-modal__header'>
        <IconButton
          className='dialog-modal__header__close'
          title={intl.formatMessage(messages.close)}
          icon='times'
          iconComponent={CloseIcon}
          onClick={onClose}
        />

        <span className='dialog-modal__header__title'>
          <FormattedMessage
            id='lists.add_to_lists'
            defaultMessage='Add {name} to lists'
            values={{ name: <strong>@{account?.acct}</strong> }}
          />
        </span>
      </div>

      <div className='dialog-modal__content'>
        <div className='lists-scrollable'>
          <NewListItem onCreate={handleCreate} />

          {lists.map((list) => (
            <ListItem
              key={list.id}
              id={list.id}
              title={list.title}
              checked={listIds.includes(list.id)}
              onChange={handleToggle}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

// eslint-disable-next-line import/no-default-export
export default ListAdder;
