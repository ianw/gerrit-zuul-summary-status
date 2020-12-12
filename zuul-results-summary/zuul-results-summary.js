// Copyright (c) 2020 Red Hat
//
// Licensed under the Apache License, Version 2.0 (the "License"); you may
// not use this file except in compliance with the License. You may obtain
// a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
// WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
// License for the specific language governing permissions and limitations
// under the License.


// TODO(ianw) : find some way to make this configurable
const ZUUL_PRIORITY = [22348];

/*
 * Tab contents
 */
class ZuulSummaryStatusTab extends Polymer.Element {
  static get properties() {
    return {
      change: Object,
      revision: Object,
    };
  }

  static get template() {
    return Polymer.html`
  <style>
    table {
      table-layout: fixed;
      width: 100%;
      border-collapse: collapse;
    }

    th, td {
      text-align: left;
      padding: 2px;
    }

    th {
      background-color: var(--background-color-primary, #f7ffff);
      font-weight: normal;
      color: var(--primary-text-color, rgb(33, 33, 33));
    }

    a:link {
      color: var(--link-color);
    }

    tr:nth-child(even) {
     background-color: var(--background-color-secondary, #f2f2f2);
    }

    tr:nth-child(odd) {
     background-color: var(--background-color-tertiary, #f7ffff);
    }

    .status-SUCCESS {
      color: green;
    }

    .status-FAILURE {
      color: red;
    }

    .status-NODE_FAILURE {
      color: orange;
    }
  </style>

  <template is="dom-repeat" items="[[__table]]">
   <div style="padding-left:5px">
   <table>
    <tr>
     <th>
      <template is="dom-if" if="{{item.succeeded}}"><span style="color:green"><iron-icon icon="gr-icons:check"></iron-icon></span></template>
      <template is="dom-if" if="{{!item.succeeded}}"><span style="color:red"><iron-icon icon="gr-icons:close"></iron-icon></span></template>
      <b>[[item.author_name]]</b> on Patchset <b>[[item.revision]]</b> in pipeline <b>[[item.pipeline]]</b></th>
     <th><template is="dom-if" if="{{item.rechecks}}">[[item.rechecks]] rechecks</template></th>
     <th><b>[[item.date_string]]</b></th>
    </tr>
    <template is="dom-repeat" items="[[item.results]]" as="job">
     <tr>
      <template is="dom-if" if="{{job.link}}"><td><a href="{{job.link}}">[[job.job]]</a></td></template>
      <template is="dom-if" if="{{!job.link}}"><td><a>[[job.job]]</a></td></template>
      <td><span class$="status-[[job.result]]">[[job.result]]</span></td>
      <td>[[job.time]]</td>
     </tr>
    </template>
   </table>
   </div>
  </template>`;
  }

  _match_message_via_tag(message) {
    return (message.tag &&
                message.tag.startsWith('autogenerated:zuul')) ? true : false;
  }

  _match_message_via_regex(message) {
    // TODO: allow this to be passed in via config
    const authorRe = /^(?<author>.* CI|Zuul)/;
    const author = authorRe.exec(message.author.name);
    return author ? true : false;
  }

  _get_status_and_pipeline(message) {
    // Look for the full Zuul-3ish build status message, e.g.:
    //    Build succeeded (check pipeline).
    const statusRe = /^Build (?<status>\w+) \((?<pipeline>[\w]+) pipeline\)\./gm;
    let statusMatch = statusRe.exec(message.message);
    if (!statusMatch) {
      // Match non-pipeline CI comments, e.g.:
      //   Build succeeded.
      const statusRe = /^Build (?<status>\w+)\./gm;
      statusMatch = statusRe.exec(message.message);
    }
    if (!statusMatch) {
      return false; // we can't parse this
    }

    const status = statusMatch.groups.status;
    const pipeline = statusMatch.groups.pipeline ?
      statusMatch.groups.pipeline : 'unknown';
    return [status, pipeline];
  }

  ready() {
    super.ready();

    /*
     * change-view-tab-content gets passed ChangeInfo object [1],
     * registered in the property "change".  We walk the list of
     * messages with some regexps to extract into a datastructure
     * stored in __table
     *
     * __table is an [] of objects
     *
     *  author: "<string> CI"
     *  date: date message posted
     *  date_string: printable version of date
     *  revision: the revision the patchset was made against
     *  rechecks: the number of times we've seen the same
     *    ci run for the same revision
     *  status: one of <succeeded|failed>
     *  pipeline: string of reporting pipeline
     *    (may be undefined for some CI)
     *  results: [] of objects
     *    job: job name
     *    link: raw URL link to logs
     *    result: one of <SUCCESS|FAILURE>
     *    time: duration of run in human string (e.g. 2m 5s)
     *
     * This is then presented by the template
     *
     * [1] https://gerrit-review.googlesource.com/Documentation/rest-api-changes.html#change-info
     */
    this.__table = [];
    this.change.messages.forEach(message => {
      if (! (this._match_message_via_tag(message) ||
                    this._match_message_via_regex(message))) {
        return;
      }

      const date = new Date(message.date);
      const revision = message._revision_number;
      const sp = this._get_status_and_pipeline(message);
      if (!sp) {
        // This shouldn't happen as we've validated it is a Zuul message.
        return;
      }
      const status = sp[0];
      const pipeline = sp[1];

      // We only want the latest entry for each CI system in
      // each pipeline
      const existing = this.__table.findIndex(entry =>
        (entry.author_id === message.author._account_id) &&
                    (entry.pipeline === pipeline));

      // If this is a comment by the same CI on the same pipeline and
      // the same revision, it's considered a "recheck" ... i.e. likely
      // manually triggered to run again.  Take a note of this.
      let rechecks = 0;
      if (existing != -1) {
        if (this.__table[existing].revision === revision) {
          rechecks = this.__table[existing].rechecks + 1;
        }
      }

      // Find each result line, e.g. :
      //   - openstack-tox-py35 http://... : SUCCESS in 2m 45
      const results = [];
      const lines = message.message.split('\n');
      const resultRe = /^- (?<job>[^ ]+) (?:(?<link>https?:\/\/[^ ]+)|[^ ]+) : (?<result>[^ ]+) in (?<time>.*)/;
      lines.forEach(line => {
        const result = resultRe.exec(line);
        if (result) {
          results.push(result.groups);
        }
      });

      const table = {
        author_name: message.author.name,
        author_id: message.author._account_id,
        revision,
        rechecks,
        date,
        date_string: date.toLocaleString(),
        status,
        succeeded: status === 'succeeded' ? true : false,
        pipeline,
        results,
      };

      if (existing == -1) {
        this.__table.push(table);
      } else {
        this.__table[existing] = table;
      }

      // Sort first by listed priority, then by date
      this.__table.sort((a, b) => {
        // >>> 0 is just a trick to convert -1 to uint max
        // of 2^32-1
        const p_a = ZUUL_PRIORITY.indexOf(a.author_id) >>> 0;
        const p_b = ZUUL_PRIORITY.indexOf(b.author_id) >>> 0;
        const priority = p_a - p_b;
        const date = b.date - a.date;
        return priority || date;
      });
    });
  }
}

customElements.define('zuul-summary-status-tab',
    ZuulSummaryStatusTab);

/*
 * Tab Header Element
 */
class ZuulSummaryStatusTabHeader extends Polymer.Element {
  static get template() {
    return Polymer.html`Zuul Summary`;
  }
}

customElements.define('zuul-summary-status-tab-header',
    ZuulSummaryStatusTabHeader);

/*
 * Install plugin
 */
Gerrit.install(plugin => {
  'use strict';

  plugin.registerDynamicCustomComponent(
      'change-view-tab-header',
      'zuul-summary-status-tab-header'
  );

  plugin.registerDynamicCustomComponent(
      'change-view-tab-content',
      'zuul-summary-status-tab'
  );
});
